import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.ts';

/** The committed migrations; `src/db` and `dist/db` both sit two levels below the root. */
const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Brings the schema up to date; forward-only, so a downgrade is a backup restore. */
export function migrateDatabase(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS });
}
