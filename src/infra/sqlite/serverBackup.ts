import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { BackupKind } from '../../store/records.ts';
import type { Store } from '../../store/Store.ts';
import { PAGE, recordsOf, withoutNulls, writeEach } from '../rows.ts';
import type { Db } from './client.ts';
import { accounts, blobs, notes, noteTags, sessions, shares, tags, tombstones } from './schema.ts';

/** Paged in primary-key order, so OFFSET pages neither skip nor repeat a row. */
const TABLES: Record<BackupKind, { table: SQLiteTable; key: SQLiteColumn[] }> = {
  accounts: { table: accounts, key: [accounts.id] },
  sessions: { table: sessions, key: [sessions.id] },
  notes: { table: notes, key: [notes.accountId, notes.id] },
  tags: { table: tags, key: [tags.accountId, tags.id] },
  noteTags: { table: noteTags, key: [noteTags.accountId, noteTags.noteId, noteTags.tagId] },
  tombstones: { table: tombstones, key: [tombstones.accountId, tombstones.kind, tombstones.id] },
  blobRecords: { table: blobs, key: [blobs.id] },
  shares: { table: shares, key: [shares.id] },
};

const recordsIn = (db: Db) =>
  recordsOf((kind, offset) =>
    db
      .select()
      .from(TABLES[kind].table)
      .orderBy(...TABLES[kind].key)
      .limit(PAGE)
      .offset(offset)
      .all()
      .map((row) => withoutNulls(row))
  );

const isEmpty = (db: Db) =>
  db.select({ id: accounts.id }).from(accounts).limit(1).all().length === 0;

/** Correct only one call at a time, like the rest of the SQLite Store: it runs behind the lock. */
export function serverBackupOf(db: Db): Store['serverBackup'] {
  return {
    async isEmpty() {
      return isEmpty(db);
    },
    async read(fn) {
      // Deferred, so it takes no write lock: under WAL other connections' writers go on, and its
      // snapshot sees none of their commits.
      db.$client.exec('BEGIN');
      try {
        return await fn(recordsIn(db));
      } finally {
        if (db.$client.inTransaction) db.$client.exec('COMMIT');
      }
    },
    async write(records) {
      db.$client.exec('BEGIN IMMEDIATE');
      try {
        if (!isEmpty(db)) throw new Error('A Server Backup is written only into an empty Store');
        await writeEach(records, (kind, batch) =>
          db.insert(TABLES[kind].table).values(batch).run()
        );
        db.$client.exec('COMMIT');
      } catch (error) {
        if (db.$client.inTransaction) db.$client.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
