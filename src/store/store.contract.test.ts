import { setTimeout } from 'node:timers/promises';
import { inspect } from 'node:util';
import { beforeEach, describe, expect, it } from 'vitest';
import { Conflict } from '../shared/errors.ts';
import {
  account,
  attachment,
  blob,
  eachStore,
  minutes,
  note,
  session,
  share,
  T,
} from '../test/storeContract.ts';
import type { Store, StoreTx } from './Store.ts';

// What every Store promises the services (ADR 0006); each implementation runs all of it. The
// sync group is in sync.contract.test.ts.
eachStore((current) => {
  let store: Store;
  beforeEach(() => {
    store = current();
  });

  it('answers ping', async () => {
    await expect(store.ping()).resolves.toBeUndefined();
  });

  describe('accounts', () => {
    it('finds by id or username, lists oldest first, ties by id, knows the Owner', async () => {
      await store.accounts.add(account('ab', 'member', minutes(1)));
      const a = { id: 'a', username: 'user-a', role: 'owner', createdAt: T };
      expect(await store.accounts.find('a')).toEqual(a);
      expect(await store.accounts.find('x')).toBeUndefined();
      expect(await store.accounts.findByUsername('user-a')).toEqual({
        ...a,
        passwordHash: 'hash-a',
      });
      expect((await store.accounts.list()).map(({ id }) => id)).toEqual(['a', 'ab', 'b']);
      expect(await store.accounts.owner()).toEqual(a);
    });

    it('refuses a username that is taken', async () => {
      const failing = store.accounts.add({ ...account('c'), username: 'user-a' });
      await expect(failing).rejects.toThrow(Conflict);
      expect(await store.accounts.find('c')).toBeUndefined();
    });

    it('fails without quoting what it was asked to write', async () => {
      const error = await store.accounts
        .add({ ...account('a'), username: 'fresh', passwordHash: 'secret-hash' })
        .catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      expect(inspect(error, { depth: 5 })).not.toContain('secret-hash');
    });

    it('replaces a password, and says when there is no such Account', async () => {
      expect(await store.accounts.setPassword('b', 'new', minutes(5))).toBe(true);
      expect((await store.accounts.findByUsername('user-b'))?.passwordHash).toBe('new');
      expect(await store.accounts.setPassword('x', 'new', minutes(5))).toBe(false);
    });
  });

  describe('sessions', () => {
    it('finds a Session by its token hash, with its Account, and touches it', async () => {
      await store.sessions.add(session('s', 'b', minutes(60)));
      const found = await store.sessions.findByTokenHash('token-s');
      expect(found?.session).toEqual(session('s', 'b', minutes(60)));
      expect(found?.account).toMatchObject({ id: 'b', username: 'user-b', role: 'member' });
      await store.sessions.touch('s', minutes(10));
      expect((await store.sessions.findByTokenHash('token-s'))?.session.lastSeenAt).toBe(
        minutes(10)
      );
      expect(await store.sessions.findByTokenHash('nope')).toBeUndefined();
    });

    it("lists an Account's live Sessions oldest first, ties by id", async () => {
      await store.sessions.add(session('later', 'a', minutes(60), minutes(2)));
      await store.sessions.add(session('first', 'a', minutes(60), minutes(1)));
      await store.sessions.add(session('early', 'a', minutes(60), minutes(2)));
      await store.sessions.add(session('expired', 'a', minutes(30)));
      await store.sessions.add(session('other', 'b', minutes(60)));
      const live = await store.sessions.listLive('a', minutes(30));
      expect(live.map(({ id }) => id)).toEqual(['first', 'early', 'later']);
    });

    it('removes only a Session the Account owns', async () => {
      await store.sessions.add(session('s', 'a', minutes(60)));
      expect(await store.sessions.removeOwned('b', 's')).toBe(false);
      expect(await store.sessions.removeOwned('a', 's')).toBe(true);
      expect(await store.sessions.removeOwned('a', 's')).toBe(false);
      await store.sessions.add(session('t', 'a', minutes(60)));
      await store.sessions.remove('t');
      expect(await store.sessions.findByTokenHash('token-t')).toBeUndefined();
    });
  });

  describe('codes', () => {
    const code = (codeHash: string, kind: 'setup' | 'device', expiresAt = minutes(10)) => ({
      codeHash,
      kind,
      ...(kind === 'device' ? { accountId: 'a' } : {}),
      createdAt: T,
      expiresAt,
    });

    it('spends a code once, of its own kind, before it expires', async () => {
      await store.codes.add(code('c', 'device'));
      expect(await store.codes.spend('c', 'setup', T)).toBeUndefined();
      expect(await store.codes.spend('c', 'device', minutes(10))).toBeUndefined();
      expect(await store.codes.spend('c', 'device', minutes(9))).toEqual({ accountId: 'a' });
      expect(await store.codes.spend('c', 'device', minutes(9))).toBeUndefined();
    });

    it('spends a setup code to no Account, and removes setup codes only', async () => {
      await store.codes.add(code('s1', 'setup'));
      await store.codes.add(code('s2', 'setup'));
      await store.codes.add(code('d', 'device'));
      expect(await store.codes.spend('s1', 'setup', T)).toEqual({});
      await store.codes.removeSetupCodes();
      expect(await store.codes.spend('s2', 'setup', T)).toBeUndefined();
      expect(await store.codes.spend('d', 'device', T)).toEqual({ accountId: 'a' });
    });
  });

  describe('blobRecords', () => {
    it('keeps the first record of an id and scopes "owned" to the Account', async () => {
      await store.blobRecords.add(blob('x', 'a'));
      await store.blobRecords.add({ ...blob('x', 'b'), size: 9 });
      expect(await store.blobRecords.find('x')).toEqual(blob('x', 'a'));
      expect(await store.blobRecords.findOwned('a', 'x')).toEqual(blob('x', 'a'));
      expect(await store.blobRecords.findOwned('b', 'x')).toBeUndefined();
      await store.blobRecords.add(blob('y', 'b'));
      expect((await store.blobRecords.ids()).sort()).toEqual(['x', 'y']);
      await store.blobRecords.remove('x');
      expect(await store.blobRecords.ids()).toEqual(['y']);
    });
  });

  describe('shares', () => {
    it('finds, lists oldest first (ties by id) and removes only within the Account', async () => {
      await store.shares.add(share('s2', 'a', 'n2', minutes(2)));
      await store.shares.add(share('s1', 'a', 'n1', minutes(1)));
      await store.shares.add(share('s0', 'a', 'n0', minutes(2)));
      await store.shares.add(share('s3', 'b', 'n1'));
      expect(await store.shares.findOwned('a', 's1')).toEqual(share('s1', 'a', 'n1', minutes(1)));
      expect(await store.shares.findOwned('b', 's1')).toBeUndefined();
      expect((await store.shares.findForNote('b', 'n1'))?.id).toBe('s3');
      expect((await store.shares.list('a')).map(({ id }) => id)).toEqual(['s1', 's0', 's2']);
      expect(await store.shares.removeOwned('b', 's1')).toBe(false);
      expect(await store.shares.removeOwned('a', 's1')).toBe(true);
      expect(await store.shares.findOwned('a', 's1')).toBeUndefined();
    });

    it('reads the shared Note by token while the Note exists', async () => {
      await store.sync.putNote('a', note('n', { body: 'shared' }), 1);
      await store.shares.add(share('s', 'a', 'n'));
      expect(await store.shares.sharedNote('token-s')).toEqual({
        accountId: 'a',
        note: note('n', { body: 'shared' }),
      });
      expect(await store.shares.sharedNote('nope')).toBeUndefined();
      await store.sync.removeNote('a', 'n');
      expect(await store.shares.sharedNote('token-s')).toBeUndefined();
    });
  });

  describe('housekeeping', () => {
    it('prunes Tombstones before the cutoff and only ever raises the pruned Sequence', async () => {
      const tombstone = (accountId: string, id: string, seq: number, deletedAt: string) =>
        store.sync.addTombstone(accountId, { kind: 'note', id, deletedAt }, seq);
      await tombstone('a', 'old', 4, minutes(-2));
      await tombstone('a', 'older', 3, minutes(-3));
      await tombstone('a', 'edge', 5, minutes(0));
      await tombstone('b', 'theirs', 2, minutes(-1));
      await store.housekeeping.pruneTombstones(minutes(0));
      expect(await store.sync.sequence('a')).toEqual({ seq: 0, prunedSeq: 4 });
      expect(await store.sync.sequence('b')).toEqual({ seq: 0, prunedSeq: 2 });
      expect((await store.sync.changesSince('a', 0, 10)).tombstones.map((t) => t.seq)).toEqual([5]);
      await tombstone('a', 'late', 1, minutes(-5));
      await store.housekeeping.pruneTombstones(minutes(0));
      expect((await store.sync.sequence('a')).prunedSeq).toBe(4);
    });

    it('removes expired Sessions, dead codes and Share Links whose Note is gone', async () => {
      await store.sessions.add(session('gone', 'a', minutes(0)));
      await store.sessions.add(session('kept', 'a', minutes(1)));
      await store.housekeeping.removeExpiredSessions(minutes(0));
      expect((await store.sessions.listLive('a', T)).map(({ id }) => id)).toEqual(['kept']);

      const code = (codeHash: string, expiresAt: string) =>
        store.codes.add({ codeHash, kind: 'device', accountId: 'a', createdAt: T, expiresAt });
      await code('expired', minutes(0));
      await code('live', minutes(1));
      await store.housekeeping.removeDeadCodes(minutes(0));
      // Spent before its expiry, which a remaining row would allow.
      expect(await store.codes.spend('expired', 'device', minutes(-1))).toBeUndefined();
      expect(await store.codes.spend('live', 'device', minutes(0))).toEqual({ accountId: 'a' });
      await store.housekeeping.removeDeadCodes(minutes(0));
      await expect(code('live', minutes(1))).resolves.toBeUndefined();

      await store.sync.putNote('a', note('n'), 1);
      await store.shares.add(share('kept', 'a', 'n'));
      await store.shares.add(share('orphan', 'a', 'purged'));
      await store.housekeeping.removeOrphanShares();
      expect((await store.shares.list('a')).map(({ id }) => id)).toEqual(['kept']);
    });

    it('finds old blobs no Note of their Account lists, thumbnails included', async () => {
      await store.blobRecords.add(blob('full', 'a', minutes(-10)));
      await store.blobRecords.add(blob('thumb', 'a', minutes(-10)));
      await store.blobRecords.add(blob('young', 'a', minutes(0)));
      await store.blobRecords.add(blob('loose', 'a', minutes(-10)));
      await store.blobRecords.add(blob('foreign', 'b', minutes(-10)));
      const attachments = [attachment('full', 'thumb'), attachment('foreign')];
      await store.sync.putNote('a', note('n', { attachments }), 1);
      const unreferenced = await store.housekeeping.unreferencedBlobs(minutes(0));
      expect(unreferenced.sort()).toEqual(['foreign', 'loose']);
    });
  });

  describe('transaction', () => {
    it('commits when fn resolves and returns its value', async () => {
      const value = await store.transaction(async (tx) => {
        await tx.sync.setSequence('a', 3);
        return 'done';
      });
      expect(value).toBe('done');
      expect((await store.sync.sequence('a')).seq).toBe(3);
    });

    it('rolls back and rethrows when fn rejects', async () => {
      const failing = store.transaction(async (tx) => {
        await tx.sync.setSequence('a', 3);
        throw new Error('boom');
      });
      await expect(failing).rejects.toThrow('boom');
      expect((await store.sync.sequence('a')).seq).toBe(0);
    });

    it('keeps a concurrent call out of an open transaction', async () => {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let wrote = () => {};
      const written = new Promise<void>((resolve) => {
        wrote = resolve;
      });
      const failing = store.transaction(async (tx) => {
        await tx.sync.setSequence('a', 3);
        wrote();
        await held;
        throw new Error('roll back');
      });
      await written;
      // Made while the transaction holds an uncommitted write and waits.
      const read = store.sync.sequence('a');
      const write = store.sync.setSequence('b', 5);
      release();
      await expect(failing).rejects.toThrow('roll back');
      expect((await read).seq).toBe(0);
      await write;
      expect((await store.sync.sequence('b')).seq).toBe(5);
    });

    it('holds a locked Account until the transaction ends', async () => {
      const pairs = [
        ['write', 'write'],
        ['write', 'read'],
        ['read', 'write'],
      ] as const;
      for (const [held, wanted] of pairs) {
        const events: string[] = [];
        let release = () => {};
        const releasing = new Promise<void>((resolve) => {
          release = resolve;
        });
        let locked = () => {};
        const locking = new Promise<void>((resolve) => {
          locked = resolve;
        });
        const first = store.transaction(async (tx) => {
          await tx.accounts.lock('a', held);
          locked();
          await releasing;
          events.push('first ends');
        });
        await locking;
        const second = store.transaction(async (tx) => {
          await tx.accounts.lock('a', wanted);
          events.push('second locks');
        });
        // Time for a lock that does not hold to let the second through.
        await setTimeout(50);
        release();
        await Promise.all([first, second]);
        expect(events, `${held} then ${wanted}`).toEqual(['first ends', 'second locks']);
      }
    });

    it('locks an unknown Account without complaint', async () => {
      await expect(
        store.transaction((tx) => tx.accounts.lock('x', 'write'))
      ).resolves.toBeUndefined();
    });

    it('throws when a tx is used after its transaction ended', async () => {
      let kept: StoreTx | undefined;
      await store.transaction(async (tx) => {
        kept = tx;
      });
      await expect(kept!.sync.setSequence('a', 3)).rejects.toThrow(/after its transaction/);
      expect((await store.sync.sequence('a')).seq).toBe(0);
    });

    it('throws, instead of waiting forever, when fn calls the outer Store', async () => {
      const nested = store.transaction(async (tx) => {
        await tx.sync.setSequence('a', 3);
        await store.accounts.list();
      });
      await expect(nested).rejects.toThrow(/inside transaction/);
      expect((await store.sync.sequence('a')).seq).toBe(0);
    });
  });
});
