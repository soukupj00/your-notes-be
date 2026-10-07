import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { whileMigrating } from './client.ts';

/** Works from `src/` and `dist/` alike, both being at the same depth. */
export const MIGRATIONS = fileURLToPath(new URL('../../../drizzle/postgres', import.meta.url));

/** Forward-only, so a downgrade is a backup restore. */
export async function migrateDatabase(client: pg.Client): Promise<void> {
  await whileMigrating(client, () => migrate(drizzle(client), { migrationsFolder: MIGRATIONS }));
}
