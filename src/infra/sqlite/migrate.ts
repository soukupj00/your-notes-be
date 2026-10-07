import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.ts';

/** Works from `src/` and `dist/` alike, both being at the same depth. */
const MIGRATIONS = fileURLToPath(new URL('../../../drizzle/sqlite', import.meta.url));

/** Forward-only, so a downgrade is a backup restore. */
export function migrateDatabase(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS });
}
