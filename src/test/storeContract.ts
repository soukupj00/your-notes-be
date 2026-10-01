// The Store contract suites (src/store/*.contract.test.ts) share these: the records they build and
// the Stores they run on. Left out of the build, like the rest of src/test/.
import { afterAll, afterEach, beforeAll, beforeEach, describe } from 'vitest';
import {
  closePostgresTestStore,
  pgliteTestStore,
  postgresTestStore,
} from '../infra/postgres/testing.ts';
import { openSqliteStore } from '../infra/sqlite/store.ts';
import type {
  BlobRecord,
  NewAccount,
  Role,
  SessionRecord,
  ShareRecord,
  StoredNote,
  StoredNoteTag,
  StoredTag,
} from '../store/records.ts';
import type { Store } from '../store/Store.ts';

export const T = '2026-09-28T10:00:00.000Z';
export const minutes = (n: number) => new Date(Date.parse(T) + n * 60_000).toISOString();

export const account = (id: string, role: Role = 'member', createdAt = T): NewAccount => ({
  id,
  username: `user-${id}`,
  role,
  passwordHash: `hash-${id}`,
  createdAt,
});
export const note = (id: string, extra: Partial<StoredNote> = {}): StoredNote => ({
  id,
  rev: 1,
  state: 'active',
  createdAt: T,
  updatedAt: T,
  ...extra,
});
export const tag = (id: string): StoredTag => ({
  id,
  rev: 1,
  name: id,
  createdAt: T,
  updatedAt: T,
});
export const link = (noteId: string, tagId: string): StoredNoteTag => ({
  noteId,
  tagId,
  rev: 1,
  createdAt: T,
  updatedAt: T,
});
export const session = (id: string, accountId: string, expiresAt: string, createdAt = T) =>
  ({
    id,
    accountId,
    tokenHash: `token-${id}`,
    deviceName: id,
    createdAt,
    lastSeenAt: createdAt,
    expiresAt,
  }) satisfies SessionRecord;
export const blob = (id: string, accountId: string, createdAt = T): BlobRecord => ({
  id,
  accountId,
  size: 1,
  mime: 'image/png',
  createdAt,
});
export const share = (
  id: string,
  accountId: string,
  noteId: string,
  createdAt = T
): ShareRecord => ({
  id,
  accountId,
  noteId,
  token: `token-${id}`,
  createdAt,
});
export const attachment = (id: string, thumbnailId?: string) => ({
  id,
  ...(thumbnailId ? { thumbnailId } : {}),
  noteId: 'n',
  kind: 'image' as const,
  mime: 'image/png',
  createdAt: T,
  updatedAt: T,
});

/*
 * A real PostgreSQL runs too when PG_TEST_URL names a server the tests may create databases on,
 * for example postgres://postgres:postgres@127.0.0.1:5432/postgres; CI sets it.
 */
const pgUrl = process.env.PG_TEST_URL;

/**
 * Declares `checks` once per Store (ADR 0006): SQLite in memory, PGlite, and a real PostgreSQL
 * when PG_TEST_URL is set. Each check starts with Accounts `a`, the Owner, and `b`, a minute
 * younger; `current` returns the running check's Store.
 */
export function eachStore(checks: (current: () => Store) => void): void {
  const run = (name: string, open: () => Promise<Store>) =>
    describe(`Store (${name})`, () => {
      // Opened once first, so a PGlite or a PostgreSQL database boots before the first check
      // rather than inside it.
      beforeAll(async () => {
        await (await open()).close();
      });
      let store: Store;
      beforeEach(async () => {
        store = await open();
        await store.accounts.add(account('a', 'owner'));
        await store.accounts.add(account('b', 'member', minutes(1)));
      });
      afterEach(async () => {
        await store.close();
      });
      checks(() => store);
    });

  run('SQLite in memory', async () => openSqliteStore(':memory:'));
  run('PGlite', pgliteTestStore);
  describe.skipIf(!pgUrl)('on a real PostgreSQL (PG_TEST_URL)', () => {
    afterAll(closePostgresTestStore);
    run('PostgreSQL', () => postgresTestStore(pgUrl!));
  });
}
