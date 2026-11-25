import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS as POSTGRES_MIGRATIONS } from './postgres/migrate.ts';
import { openDatabase } from './sqlite/client.ts';
import { MIGRATIONS as SQLITE_MIGRATIONS } from './sqlite/migrate.ts';

const T = '2026-09-28T10:00:00.000Z';

type Database = {
  migrate(folder: string): Promise<void>;
  run(statement: string): Promise<void>;
  rows(query: string): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
};

async function sqlite(): Promise<Database> {
  const db = openDatabase(':memory:');
  return {
    migrate: async (folder) => migrateSqlite(db, { migrationsFolder: folder }),
    run: async (statement) => void db.$client.exec(statement),
    rows: async (query) => db.$client.prepare(query).all() as Record<string, unknown>[],
    close: async () => void db.$client.close(),
  };
}

async function pglite(): Promise<Database> {
  const client = await PGlite.create();
  const db = drizzle(client);
  return {
    migrate: (folder) => migratePglite(db, { migrationsFolder: folder }),
    run: async (statement) => void (await client.exec(statement)),
    rows: async (query) => (await client.query<Record<string, unknown>>(query)).rows,
    close: () => client.close(),
  };
}

const temporary: string[] = [];
afterEach(async () => {
  for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A copy of `folder` whose journal stops just before the migration tagged `…_<name>`. */
async function migrationsBefore(folder: string, name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yournotes-migrations-'));
  temporary.push(dir);
  await cp(folder, dir, { recursive: true });
  const path = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(path, 'utf8'));
  const at = journal.entries.findIndex(({ tag }: { tag: string }) => tag.endsWith(`_${name}`));
  if (at < 1) throw new Error(`${folder} has no migration named ${name} after another`);
  journal.entries = journal.entries.slice(0, at);
  await writeFile(path, JSON.stringify(journal));
  return dir;
}

describe.each([
  ['SQLite', sqlite, SQLITE_MIGRATIONS],
  ['PGlite', pglite, POSTGRES_MIGRATIONS],
])('migrating %s', (_name, open, folder) => {
  let db: Database;
  // PGlite boots for seconds while other files boot theirs; the test's timeout must not pay for it.
  beforeAll(async () => {
    db = await open();
  });
  afterAll(() => db.close());

  it('drops the Note description and keeps every Note', async () => {
    await db.migrate(await migrationsBefore(folder, 'drop_note_description'));
    await db.run(
      `insert into accounts (id, username, role, seq, pruned_seq, created_at, updated_at)
         values ('a', 'olga', 'owner', 1, 0, '${T}', '${T}');
       insert into notes (account_id, id, rev, seq, header, description, body, state, created_at, updated_at)
         values ('a', 'n', 1, 1, 'Hi', 'old', 'b', 'active', '${T}', '${T}');`
    );

    await db.migrate(folder);

    const [note, ...others] = await db.rows('select * from notes');
    expect(others).toEqual([]);
    expect(note).toMatchObject({ id: 'n', rev: 1, header: 'Hi', body: 'b', state: 'active' });
    expect(note).not.toHaveProperty('description');
  });
});
