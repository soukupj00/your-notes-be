import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export function openDatabase(path: string | ':memory:'): Db {
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return drizzle(sqlite, { schema });
}
