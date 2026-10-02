import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Note, PushBatch } from '../contract/index.ts';
import { memoryBlobStore } from '../infra/blobs/memory.ts';
import { openPostgresStore } from '../infra/postgres/store.ts';
import { testDatabase } from '../infra/postgres/testing.ts';
import { AccountService } from '../modules/accounts/service.ts';
import { BlobService } from '../modules/blobs/service.ts';
import { PairingService } from '../modules/pairing/service.ts';
import { ShareService } from '../modules/shares/service.ts';
import { LiveUpdates } from '../modules/sync/liveUpdates.ts';
import { SyncService } from '../modules/sync/service.ts';
import { Conflict } from '../shared/errors.ts';
import type { Store } from '../store/Store.ts';

// PGlite runs one transaction at a time, so only a real PostgreSQL shows these races (ADR 0006).
const pgUrl = process.env.PG_TEST_URL;

const T = '2026-09-28T10:00:00.000Z';
const clock = () => new Date(T);
const PAGE = 200;

const note = (id: string, extra: Partial<Note> & { rev?: number } = {}) => ({
  id,
  state: 'active' as const,
  createdAt: T,
  updatedAt: T,
  ...extra,
});
const batch = (notes: PushBatch['notes']): PushBatch => ({
  notes,
  tags: [],
  noteTags: [],
  tombstones: [],
});
const times = <T>(n: number, make: (i: number) => T) =>
  Array.from({ length: n }, (_, i) => make(i));

describe.skipIf(!pgUrl)('at once, on a real PostgreSQL', () => {
  let store: Store;
  let sync: SyncService;
  let drop = async () => {};
  beforeAll(async () => {
    const database = await testDatabase(pgUrl!);
    drop = database.drop;
    store = await openPostgresStore(database.url, { warn: () => {} });
    sync = new SyncService(store, clock, new LiveUpdates(), PAGE);
  });
  afterAll(async () => {
    await store?.close();
    await drop();
  });

  async function newAccount(): Promise<string> {
    const id = randomUUID();
    await store.accounts.add({ id, username: id, role: 'member', passwordHash: '', createdAt: T });
    return id;
  }

  it('hands out distinct, gap-free Sequences and loses no advance of the Account', async () => {
    const accountId = await newAccount();
    const pushes = await Promise.all(
      times(50, (i) => sync.push(accountId, 'device', batch([note(`n${i}`)])))
    );
    expect(pushes.map(({ outcomes }) => outcomes[0]?.status)).toEqual(times(50, () => 'accepted'));
    expect(new Set(pushes.map(({ seq }) => seq)).size).toBe(50);
    const { notes } = await store.sync.changesSince(accountId, 0, PAGE);
    expect(notes.map(({ seq }) => seq).sort((a, b) => a - b)).toEqual(times(50, (i) => i + 1));
    expect((await store.sync.sequence(accountId)).seq).toBe(50);
  });

  it('accepts only one of many edits made against the same rev', async () => {
    const accountId = await newAccount();
    await sync.push(accountId, 'device', batch([note('n')]));
    const pushes = await Promise.all(
      times(20, (i) => sync.push(accountId, 'device', batch([note('n', { rev: 1, body: `${i}` })])))
    );
    const statuses = pushes.map(({ outcomes }) => outcomes[0]?.status);
    expect(statuses.filter((status) => status === 'accepted')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'conflict')).toHaveLength(19);
    expect((await store.sync.note(accountId, 'n'))?.rev).toBe(2);
  });

  it('never puts a row on a page past the Sequence the page reports', async () => {
    const accountId = await newAccount();
    await sync.push(accountId, 'device', batch([note('early')]));
    let reached = () => {};
    const reading = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release = () => {};
    const releasing = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A page that waits between reading the Sequence and reading the rows.
    const slow = new SyncService(
      {
        ...store,
        transaction: (fn) =>
          store.transaction((tx) =>
            fn({
              ...tx,
              sync: {
                ...tx.sync,
                sequence: async (id) => {
                  const sequence = await tx.sync.sequence(id);
                  reached();
                  await releasing;
                  return sequence;
                },
              },
            })
          ),
      },
      clock,
      new LiveUpdates(),
      PAGE
    );

    const paging = slow.page(accountId, 0, undefined);
    await reading;
    const pushing = sync.push(accountId, 'device', batch([note('late')]));
    // Time for the push to commit, if nothing holds it.
    await setTimeout(200);
    release();
    const [page, push] = await Promise.all([paging, pushing]);
    expect(page.seq).toBe(1);
    expect(page.notes.map(({ id }) => id)).toEqual(['early']);
    expect(push.seq).toBe(2);
  });

  it('creates one of two members who want one username, and leaves the other Invite unspent', async () => {
    const pairing = new PairingService(store, clock);
    const accounts = new AccountService(store, clock, pairing);
    const owner = await newAccount();
    const codes = [
      (await pairing.mint('invite', owner)).code,
      (await pairing.mint('invite', owner)).code,
    ];
    const username = randomUUID();
    const created = await Promise.allSettled(
      codes.map((code) => accounts.createMember({ code, username, password: 'correct horse' }))
    );
    expect(created.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    const lost = created.findIndex(({ status }) => status === 'rejected');
    const { reason } = created[lost] as PromiseRejectedResult;
    expect(reason).toBeInstanceOf(Conflict);
    expect(reason.message).toBe('That username is taken');
    const retry = { code: codes[lost]!, username: randomUUID(), password: 'correct horse' };
    await expect(accounts.createMember(retry)).resolves.toMatchObject({ role: 'member' });
  });

  it('mints one Share Link for a Note shared many times at once', async () => {
    const shares = new ShareService(store, clock, new BlobService(store, memoryBlobStore(), clock));
    const accountId = await newAccount();
    await sync.push(accountId, 'device', batch([note('n')]));
    const minted = await Promise.all(times(10, () => shares.create(accountId, 'n')));
    expect(new Set(minted.map(({ share }) => share.id)).size).toBe(1);
    expect(minted.filter(({ created }) => created)).toHaveLength(1);
  });

  it('keeps one record for a blob recorded many times at once', async () => {
    const accountId = await newAccount();
    const id = randomUUID();
    const record = (size: number) => ({ id, accountId, size, mime: 'image/png', createdAt: T });
    await Promise.all(times(10, (size) => store.blobRecords.add(record(size))));
    expect(await store.blobRecords.findOwned(accountId, id)).toBeDefined();
  });
});
