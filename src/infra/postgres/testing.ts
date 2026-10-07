// For tests only, and left out of the build.
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as overPool } from 'drizzle-orm/node-postgres';
import { drizzle as overPglite } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import type { Store } from '../../store/Store.ts';
import { guarded } from '../guarded.ts';
import type { Db } from './client.ts';
import { MIGRATIONS } from './migrate.ts';
import * as schema from './schema.ts';
import { openPostgresStore, postgresStore } from './store.ts';

const TABLES = 'accounts, sessions, codes, notes, tags, note_tags, tombstones, blobs, shares';

/** The Store's `close` leaves `db` open for the next test. */
async function emptied(db: Db): Promise<Store> {
  await db.execute(sql.raw(`truncate ${TABLES}`));
  return guarded(postgresStore(db, async () => {}));
}

let pglite: Promise<Db> | undefined;

/** The test file's one PGlite, migrated once, since starting one takes about a second. */
export async function pgliteTestStore(): Promise<Store> {
  pglite ??= (async () => {
    const db = overPglite(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    return db;
  })();
  return emptied(await pglite);
}

async function admin(url: string, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

export async function testDatabase(url: string): Promise<{ url: string; drop(): Promise<void> }> {
  const name = `younotes_test_${randomUUID().replaceAll('-', '')}`;
  await admin(url, `create database ${name}`);
  const own = new URL(url);
  own.pathname = `/${name}`;
  return {
    url: own.toString(),
    drop: () => admin(url, `drop database if exists ${name} with (force)`),
  };
}

let real: Promise<{ db: Db; end(): Promise<void> }> | undefined;

/** The test file's one database, migrated as the server does; `closePostgresTestStore` drops it. */
export async function postgresTestStore(url: string): Promise<Store> {
  real ??= (async () => {
    const database = await testDatabase(url);
    await (await openPostgresStore(database.url, { warn: () => {} })).close();
    const pool = new pg.Pool({ connectionString: database.url });
    return {
      db: overPool(pool, { schema }),
      end: async () => {
        await pool.end();
        await database.drop();
      },
    };
  })();
  return emptied((await real).db);
}

export async function closePostgresTestStore(): Promise<void> {
  await (await real)?.end();
}
