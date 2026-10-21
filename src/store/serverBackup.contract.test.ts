import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPostgresStore } from '../infra/postgres/store.ts';
import {
  closePostgresTestStore,
  pgliteTestStore,
  postgresTestStore,
  testDatabase,
} from '../infra/postgres/testing.ts';
import { openSqliteStore } from '../infra/sqlite/store.ts';
import { T } from '../test/storeContract.ts';
import { type AllRecords, BACKUP_KINDS, type BackupRecords } from './records.ts';
import type { Store } from './Store.ts';

const LATER = '2026-09-29T10:00:00.000Z';

type Everything = { [K in keyof BackupRecords]: BackupRecords[K][] };

/** One of every kind, every optional field both present and absent, in primary-key order. */
const EVERYTHING: Everything = {
  accounts: [
    {
      id: 'a',
      username: 'olga',
      passwordHash: 'scrypt-a',
      role: 'owner',
      seq: 9,
      prunedSeq: 4,
      createdAt: T,
      updatedAt: LATER,
    },
    { id: 'b', username: 'max', role: 'member', seq: 1, prunedSeq: 0, createdAt: T, updatedAt: T },
  ],
  sessions: [
    {
      id: 's',
      accountId: 'a',
      tokenHash: 'token-s',
      deviceName: 'Laptop',
      createdAt: T,
      lastSeenAt: LATER,
      expiresAt: '2027-09-28T10:00:00.000Z',
    },
  ],
  notes: [
    {
      accountId: 'a',
      seq: 5,
      id: 'n',
      rev: 3,
      header: 'Hi',
      description: 'd',
      body: 'b',
      state: 'archived',
      pinnedAt: T,
      color: 'red',
      trashedAt: T,
      remindAt: '2026-10-01T09:00',
      repeat: 'weekly',
      attachments: [
        {
          id: 'f',
          thumbnailId: 'f-thumb',
          noteId: 'n',
          kind: 'image',
          mime: 'image/png',
          createdAt: T,
          updatedAt: T,
        },
      ],
      createdAt: T,
      updatedAt: LATER,
    },
    { accountId: 'b', seq: 1, id: 'n', rev: 1, state: 'active', createdAt: T, updatedAt: T },
  ],
  tags: [
    {
      accountId: 'a',
      seq: 6,
      id: 't',
      rev: 1,
      name: 'Work',
      color: 'blue',
      createdAt: T,
      updatedAt: T,
    },
    { accountId: 'a', seq: 7, id: 'u', rev: 2, name: 'Home', createdAt: T, updatedAt: LATER },
  ],
  noteTags: [
    { accountId: 'a', seq: 8, noteId: 'n', tagId: 't', rev: 1, createdAt: T, updatedAt: T },
  ],
  tombstones: [{ accountId: 'a', seq: 9, kind: 'note', id: 'gone', deletedAt: T }],
  // Over 2 GiB, which a 32-bit column would not hold.
  blobRecords: [{ id: 'f', accountId: 'a', size: 3_000_000_000, mime: 'image/png', createdAt: T }],
  shares: [{ id: 'sh', accountId: 'a', noteId: 'n', token: 'share-token', createdAt: T }],
};

const nothing = (): Everything => ({
  accounts: [],
  sessions: [],
  notes: [],
  tags: [],
  noteTags: [],
  tombstones: [],
  blobRecords: [],
  shares: [],
});

function recordsOf(everything: Everything): AllRecords {
  return Object.fromEntries(
    BACKUP_KINDS.map((kind) => [
      kind,
      async function* () {
        yield* everything[kind];
      },
    ])
  ) as unknown as AllRecords;
}

async function collect<T>(records: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const record of records) all.push(record);
  return all;
}

function readAll(store: Store): Promise<Everything> {
  return store.serverBackup.read(async (records) => {
    const all = nothing();
    for (const kind of BACKUP_KINDS) {
      (all[kind] as unknown[]) = await collect<unknown>(records[kind]());
    }
    return all;
  });
}

const pgUrl = process.env.PG_TEST_URL;
afterAll(closePostgresTestStore);

const stores: [string, () => Promise<Store>][] = [
  ['SQLite in memory', async () => openSqliteStore(':memory:')],
  ['PGlite', pgliteTestStore],
  ...(pgUrl
    ? [['PostgreSQL', () => postgresTestStore(pgUrl)] as [string, () => Promise<Store>]]
    : []),
];

describe.each(stores)('Store.serverBackup (%s)', (_name, open) => {
  // Opened once first, so a PGlite or a PostgreSQL database boots before the first test.
  beforeAll(async () => {
    await (await open()).close();
  });

  it('is empty until it holds an Account', async () => {
    const store = await open();
    expect(await store.serverBackup.isEmpty()).toBe(true);
    await store.codes.add({ codeHash: 'c', kind: 'setup', createdAt: T, expiresAt: LATER });
    expect(await store.serverBackup.isEmpty()).toBe(true);
    await store.accounts.add({ ...EVERYTHING.accounts[1]!, passwordHash: '' });
    expect(await store.serverBackup.isEmpty()).toBe(false);
    await store.close();
  });

  it('reads back exactly what it wrote, and the domain reads it too', async () => {
    const store = await open();
    await store.serverBackup.write(recordsOf(EVERYTHING));
    await store.codes.add({
      codeHash: 'c',
      kind: 'device',
      accountId: 'a',
      createdAt: T,
      expiresAt: LATER,
    });

    expect(await readAll(store)).toEqual(EVERYTHING);
    expect(await store.sync.sequence('a')).toEqual({ seq: 9, prunedSeq: 4 });
    expect(await store.accounts.findByUsername('max')).not.toHaveProperty('passwordHash');
    expect((await store.sessions.findByTokenHash('token-s'))?.account.username).toBe('olga');
    const { seq, accountId: _, ...note } = EVERYTHING.notes[0]!;
    expect((await store.sync.changesSince('a', 0, 10)).notes).toEqual([{ seq, record: note }]);
    expect(await store.shares.sharedNote('share-token')).toEqual({ accountId: 'a', note });
    await store.close();
  });

  it('refuses to write into a Store that is not empty, writing nothing', async () => {
    const store = await open();
    const {
      passwordHash: _,
      seq: __,
      prunedSeq: ___,
      updatedAt: ____,
      ...other
    } = {
      ...EVERYTHING.accounts[0]!,
      id: 'x',
      username: 'someone',
    };
    await store.accounts.add({ ...other, passwordHash: 'hash' });
    await expect(store.serverBackup.write(recordsOf(EVERYTHING))).rejects.toThrow(/empty Store/);
    const all = await readAll(store);
    expect(all.accounts.map(({ id }) => id)).toEqual(['x']);
    expect({ ...all, accounts: [] }).toEqual(nothing());
    await store.close();
  });

  it('writes nothing when a record fails partway', async () => {
    const store = await open();
    const twice = { ...EVERYTHING, sessions: [...EVERYTHING.sessions, ...EVERYTHING.sessions] };
    await expect(store.serverBackup.write(recordsOf(twice))).rejects.toThrow();
    expect(await readAll(store)).toEqual(nothing());
    await store.close();
  });

  it('throws, instead of waiting forever, when fn calls the outer Store', async () => {
    const store = await open();
    await expect(store.serverBackup.read(() => store.accounts.list())).rejects.toThrow(
      /inside transaction/
    );
    await store.close();
  });
});

describe('Store.serverBackup from one Store into another', () => {
  for (const [from, openFrom] of stores) {
    for (const [to, openTo] of stores) {
      if (from === to) continue;
      it(`copies every record exactly, ${from} to ${to}`, async () => {
        const source = await openFrom();
        const target = await openTo();
        await source.serverBackup.write(recordsOf(EVERYTHING));
        await source.serverBackup.read((records) => target.serverBackup.write(records));
        expect(await readAll(target)).toEqual(EVERYTHING);
        await source.close();
        await target.close();
      });
    }
  }
});

/**
 * Two Stores on one database: `read` must see one snapshot while the other commits. PGlite runs
 * one transaction at a time, so it cannot show this.
 */
const pairs: [string, () => Promise<{ reader: Store; writer: Store; end(): Promise<void> }>][] = [
  [
    'SQLite file',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'yournotes-snapshot-'));
      const reader = openSqliteStore(join(dir, 'yournotes.db'));
      const writer = openSqliteStore(join(dir, 'yournotes.db'));
      return {
        reader,
        writer,
        end: async () => {
          await reader.close();
          await writer.close();
          await rm(dir, { recursive: true, force: true });
        },
      };
    },
  ],
];
if (pgUrl) {
  pairs.push([
    'PostgreSQL',
    async () => {
      const database = await testDatabase(pgUrl);
      const reader = await openPostgresStore(database.url, { warn: () => {} });
      const writer = await openPostgresStore(database.url, { warn: () => {} });
      return {
        reader,
        writer,
        end: async () => {
          await reader.close();
          await writer.close();
          await database.drop();
        },
      };
    },
  ]);
}

describe.each(pairs)('Store.serverBackup.read (%s)', (_name, openPair) => {
  it('reads one snapshot, and does not hold up the writes of another connection', async () => {
    const { reader, writer, end } = await openPair();
    try {
      await writer.serverBackup.write(recordsOf(EVERYTHING));
      const late = { ...EVERYTHING.notes[1]!, id: 'z', seq: 2 };
      const seen = await reader.serverBackup.read(async (records) => {
        const before = await collect(records.accounts());
        await writer.sync.setSequence('b', 2);
        await writer.sync.putNote('b', late, 2);
        return {
          before,
          after: await collect(records.accounts()),
          notes: await collect(records.notes()),
        };
      });
      expect(seen.after).toEqual(seen.before);
      expect(seen.notes).toEqual(EVERYTHING.notes);
      expect((await readAll(reader)).notes).toEqual([...EVERYTHING.notes, late]);
    } finally {
      await end();
    }
  });
});
