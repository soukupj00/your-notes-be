import { beforeEach, expect, it } from 'vitest';
import { type Db, openDatabase } from './db/client.ts';
import { migrateDatabase } from './db/migrate.ts';
import { accounts, codes, sessions, tombstones } from './db/schema.ts';
import { sweep } from './sweep.ts';

const NOW = new Date('2026-12-31T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

let db: Db;
beforeEach(() => {
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

it('removes Tombstones older than the window and keeps one exactly at its edge', () => {
  tombstone('a', 'old', 3, daysAgo(90.001));
  tombstone('a', 'edge', 5, daysAgo(90));
  tombstone('a', 'new', 7, daysAgo(1));
  sweep(db, NOW, 90);
  expect(db.select({ id: tombstones.id }).from(tombstones).all()).toEqual([
    { id: 'edge' },
    { id: 'new' },
  ]);
  expect(prunedSeq('a')).toBe(3);
  expect(prunedSeq('b')).toBe(0);
});

it('raises pruned_seq per Account to the newest removed Sequence and never lowers it', () => {
  tombstone('a', 'x', 4, daysAgo(100));
  tombstone('a', 'y', 9, daysAgo(95));
  tombstone('b', 'z', 2, daysAgo(200));
  sweep(db, NOW, 90);
  expect([prunedSeq('a'), prunedSeq('b')]).toEqual([9, 2]);
  db.update(accounts).set({ prunedSeq: 50 }).run();
  tombstone('a', 'w', 10, daysAgo(120));
  sweep(db, NOW, 90);
  expect(prunedSeq('a')).toBe(50);
});

it('removes expired Sessions and spent or expired Pairing Codes', () => {
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
  sweep(db, NOW, 90);
  expect(db.select({ id: sessions.id }).from(sessions).all()).toEqual([{ id: 'kept' }]);
  expect(db.select({ hash: codes.codeHash }).from(codes).all()).toEqual([{ hash: 'live' }]);
});
