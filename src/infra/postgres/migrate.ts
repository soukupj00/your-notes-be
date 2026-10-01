import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { whileMigrating } from './client.ts';

/** The committed migrations; `src/infra/postgres` and `dist/infra/postgres` are equally deep. */
export const MIGRATIONS = fileURLToPath(new URL('../../../drizzle/postgres', import.meta.url));

/** Brings the schema up to date; forward-only, so a downgrade is a backup restore. */
export async function migrateDatabase(client: pg.Client): Promise<void> {
  await whileMigrating(client, () => migrate(drizzle(client), { migrationsFolder: MIGRATIONS }));
}
