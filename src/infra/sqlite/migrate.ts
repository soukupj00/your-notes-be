import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.ts';

/** The committed migrations; `src/infra/sqlite` and `dist/infra/sqlite` sit at the same depth. */
const MIGRATIONS = fileURLToPath(new URL('../../../drizzle/sqlite', import.meta.url));

/** Brings the schema up to date; forward-only, so a downgrade is a backup restore. */
export function migrateDatabase(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS });
}
