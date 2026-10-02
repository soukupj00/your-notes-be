import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AttachmentMeta } from '../../contract/index.ts';
import type { BlobStore } from '../../store/BlobStore.ts';
import type { CodeRecord, SessionRecord } from '../../store/records.ts';
import type { Store } from '../../store/Store.ts';
import { testBlobs, testStore } from '../../test/helpers.ts';
import { HousekeepingService } from './service.ts';

const NOW = new Date('2026-12-31T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

let store: Store;
let blobs: BlobStore;
let housekeeping: HousekeepingService;
beforeEach(async () => {
  blobs = testBlobs();
  store = await testStore();
  housekeeping = new HousekeepingService(store, blobs, 90);
  for (const id of ['a', 'b']) {
    await store.accounts.add({ id, username: id, role: 'member', passwordHash: '', createdAt: '' });
  }
});
afterEach(async () => {
  await store.close();
});

const tombstone = (accountId: string, id: string, seq: number, deletedAt: string) =>
  store.sync.addTombstone(accountId, { kind: 'note', id, deletedAt }, seq);
const prunedSeq = async (id: string) => (await store.sync.sequence(id)).prunedSeq;
const noteWith = (accountId: string, attachments: AttachmentMeta[]) =>
  store.sync.putNote(
    accountId,
    { id: 'n', rev: 1, state: 'active', attachments, createdAt: '', updatedAt: '' },
    1
  );

it('removes Tombstones older than the window and keeps one exactly at its edge', async () => {
  await tombstone('a', 'old', 3, daysAgo(90.001));
  await tombstone('a', 'edge', 5, daysAgo(90));
  await tombstone('a', 'new', 7, daysAgo(1));
  await housekeeping.sweep(NOW);
  const { tombstones } = await store.sync.changesSince('a', 0, 10);
  expect(tombstones.map(({ record }) => ({ id: record.id }))).toEqual([
    { id: 'edge' },
    { id: 'new' },
  ]);
  expect(await prunedSeq('a')).toBe(3);
  expect(await prunedSeq('b')).toBe(0);
});

it('raises pruned_seq per Account to the newest removed Sequence and never lowers it', async () => {
  await tombstone('a', 'x', 4, daysAgo(100));
  await tombstone('a', 'y', 9, daysAgo(95));
  await tombstone('b', 'z', 2, daysAgo(200));
  await housekeeping.sweep(NOW);
  expect([await prunedSeq('a'), await prunedSeq('b')]).toEqual([9, 2]);
  await tombstone('a', 'v', 50, daysAgo(110));
  await housekeeping.sweep(NOW);
  await tombstone('a', 'w', 10, daysAgo(120));
  await housekeeping.sweep(NOW);
  expect(await prunedSeq('a')).toBe(50);
});

it('removes expired Sessions and spent or expired Pairing Codes', async () => {
  const session = (id: string, expiresAt: string): SessionRecord => ({
    id,
    accountId: 'a',
    tokenHash: id,
    deviceName: id,
    createdAt: '',
    lastSeenAt: '',
    expiresAt,
  });
  await store.sessions.add(session('gone', daysAgo(0)));
  await store.sessions.add(session('kept', daysAgo(-1)));
  const code = (codeHash: string, expiresAt: string): CodeRecord => ({
    codeHash,
    kind: 'device',
    accountId: 'a',
    createdAt: '',
    expiresAt,
  });
  await store.codes.add(code('expired', daysAgo(0)));
  await store.codes.add(code('used', daysAgo(-1)));
  await store.codes.spend('used', 'device', daysAgo(1));
  await store.codes.add(code('live', daysAgo(-1)));
  await housekeeping.sweep(NOW);
  // Each check would find a row the sweep left, so it passes only once the row is gone.
  const live = await store.sessions.listLive('a', daysAgo(1));
  expect(live.map(({ id }) => ({ id }))).toEqual([{ id: 'kept' }]);
  expect(await store.codes.spend('expired', 'device', daysAgo(1))).toBeUndefined();
  await expect(store.codes.add(code('used', daysAgo(-1)))).resolves.toBeUndefined();
  expect(await store.codes.spend('live', 'device', NOW.toISOString())).toEqual({ accountId: 'a' });
});

it('removes bytes no Note of their Account references for a day, and files without a row', async () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const blob = async (n: number, accountId: string, createdAt: string) => {
    await blobs.put(id(n), Buffer.from('x'), 1);
    await store.blobRecords.add({ id: id(n), accountId, size: 1, mime: 'image/png', createdAt });
  };
  await blob(1, 'a', daysAgo(2)); // referenced by a's Note: stays
  await blob(2, 'a', daysAgo(0.5)); // unreferenced but young: stays
  await blob(3, 'a', daysAgo(2)); // unreferenced and old: goes
  await blob(4, 'b', daysAgo(2)); // referenced only by another Account's Note: goes
  await blobs.put(id(5), Buffer.from('x'), 1); // a file without a row: goes
  const attachment = (n: number) => ({
    id: id(n),
    noteId: 'n',
    kind: 'image' as const,
    mime: 'image/png',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  await noteWith('a', [attachment(1), attachment(4)]);

  await housekeeping.sweep(NOW);
  expect((await blobs.list()).sort()).toEqual([id(1), id(2)]);
  expect((await store.blobRecords.ids()).sort()).toEqual([id(1), id(2)]);
});

it("keeps an image's thumbnail blob, referenced by thumbnailId", async () => {
  const full = '00000000-0000-4000-8000-000000000011';
  const thumb = '00000000-0000-4000-8000-000000000012';
  for (const id of [full, thumb]) {
    await blobs.put(id, Buffer.from('x'), 1);
    await store.blobRecords.add({
      id,
      accountId: 'a',
      size: 1,
      mime: 'image/png',
      createdAt: daysAgo(2),
    });
  }
  await noteWith('a', [
    {
      id: full,
      thumbnailId: thumb,
      noteId: 'n',
      kind: 'image',
      mime: 'image/png',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    },
  ]);
  await housekeeping.sweep(NOW);
  expect((await blobs.list()).sort()).toEqual([full, thumb]);
});
