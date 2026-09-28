import { beforeEach, expect, it } from 'vitest';
import type { BlobStore } from './blobs/BlobStore.ts';
import { memoryBlobStore } from './blobs/memory.ts';
import { type Db, openDatabase } from './db/client.ts';
import { migrateDatabase } from './db/migrate.ts';
import { accounts, blobs, codes, notes, sessions, tombstones } from './db/schema.ts';
import { sweep } from './sweep.ts';

const NOW = new Date('2026-12-31T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

let db: Db;
let store: BlobStore;
beforeEach(() => {
  store = memoryBlobStore();
  db = openDatabase(':memory:');
  migrateDatabase(db);
  for (const id of ['a', 'b']) {
    db.insert(accounts)
      .values({ id, username: id, role: 'member', createdAt: '', updatedAt: '' })
      .run();
  }
});

const tombstone = (accountId: string, id: string, seq: number, deletedAt: string) =>
  db.insert(tombstones).values({ accountId, kind: 'note', id, seq, deletedAt }).run();
const prunedSeq = (id: string) =>
  db
    .select()
    .from(accounts)
    .all()
    .find((row) => row.id === id)?.prunedSeq;

it('removes Tombstones older than the window and keeps one exactly at its edge', async () => {
  tombstone('a', 'old', 3, daysAgo(90.001));
  tombstone('a', 'edge', 5, daysAgo(90));
  tombstone('a', 'new', 7, daysAgo(1));
  await sweep(db, store, NOW, 90);
  expect(db.select({ id: tombstones.id }).from(tombstones).all()).toEqual([
    { id: 'edge' },
    { id: 'new' },
  ]);
  expect(prunedSeq('a')).toBe(3);
  expect(prunedSeq('b')).toBe(0);
});

it('raises pruned_seq per Account to the newest removed Sequence and never lowers it', async () => {
  tombstone('a', 'x', 4, daysAgo(100));
  tombstone('a', 'y', 9, daysAgo(95));
  tombstone('b', 'z', 2, daysAgo(200));
  await sweep(db, store, NOW, 90);
  expect([prunedSeq('a'), prunedSeq('b')]).toEqual([9, 2]);
  db.update(accounts).set({ prunedSeq: 50 }).run();
  tombstone('a', 'w', 10, daysAgo(120));
  await sweep(db, store, NOW, 90);
  expect(prunedSeq('a')).toBe(50);
});

it('removes expired Sessions and spent or expired Pairing Codes', async () => {
  const session = (id: string, expiresAt: string) => ({
    id,
    accountId: 'a',
    tokenHash: id,
    deviceName: id,
    createdAt: '',
    lastSeenAt: '',
    expiresAt,
  });
  db.insert(sessions)
    .values([session('gone', daysAgo(0)), session('kept', daysAgo(-1))])
    .run();
  const code = (codeHash: string, expiresAt: string, usedAt: string | null) => ({
    codeHash,
    kind: 'device' as const,
    accountId: 'a',
    createdAt: '',
    expiresAt,
    usedAt,
  });
  db.insert(codes)
    .values([
      code('expired', daysAgo(0), null),
      code('used', daysAgo(-1), daysAgo(1)),
      code('live', daysAgo(-1), null),
    ])
    .run();
  await sweep(db, store, NOW, 90);
  expect(db.select({ id: sessions.id }).from(sessions).all()).toEqual([{ id: 'kept' }]);
  expect(db.select({ hash: codes.codeHash }).from(codes).all()).toEqual([{ hash: 'live' }]);
});

it('removes bytes no Note of their Account references for a day, and files without a row', async () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  const blob = async (n: number, accountId: string, createdAt: string) => {
    await store.put(id(n), Buffer.from('x'), 1);
    db.insert(blobs)
      .values({ id: id(n), accountId, size: 1, mime: 'image/png', createdAt })
      .run();
  };
  await blob(1, 'a', daysAgo(2)); // referenced by a's Note: stays
  await blob(2, 'a', daysAgo(0.5)); // unreferenced but young: stays
  await blob(3, 'a', daysAgo(2)); // unreferenced and old: goes
  await blob(4, 'b', daysAgo(2)); // referenced only by another Account's Note: goes
  await store.put(id(5), Buffer.from('x'), 1); // a file without a row: goes
  const attachment = (n: number) => ({
    id: id(n),
    noteId: 'n',
    kind: 'image' as const,
    mime: 'image/png',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
  db.insert(notes)
    .values({
      accountId: 'a',
      id: 'n',
      rev: 1,
      seq: 1,
      state: 'active',
      attachments: [attachment(1), attachment(4)],
      createdAt: '',
      updatedAt: '',
    })
    .run();

  await sweep(db, store, NOW, 90);
  expect((await store.list()).sort()).toEqual([id(1), id(2)]);
  expect(
    db
      .select({ id: blobs.id })
      .from(blobs)
      .all()
      .map((row) => row.id)
      .sort()
  ).toEqual([id(1), id(2)]);
});

it("keeps an image's thumbnail blob, referenced by thumbnailId", async () => {
  const full = '00000000-0000-4000-8000-000000000011';
  const thumb = '00000000-0000-4000-8000-000000000012';
  for (const id of [full, thumb]) {
    await store.put(id, Buffer.from('x'), 1);
    db.insert(blobs)
      .values({ id, accountId: 'a', size: 1, mime: 'image/png', createdAt: daysAgo(2) })
      .run();
  }
  db.insert(notes)
    .values({
      accountId: 'a',
      id: 'n',
      rev: 1,
      seq: 1,
      state: 'active',
      attachments: [
        {
          id: full,
          thumbnailId: thumb,
          noteId: 'n',
          kind: 'image',
          mime: 'image/png',
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
        },
      ],
      createdAt: '',
      updatedAt: '',
    })
    .run();
  await sweep(db, store, NOW, 90);
  expect((await store.list()).sort()).toEqual([full, thumb]);
});
