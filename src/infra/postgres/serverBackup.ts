import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { BackupKind } from '../../store/records.ts';
import type { Store } from '../../store/Store.ts';
import { PAGE, recordsOf, withoutNulls, writeEach } from '../rows.ts';
import type { Db } from './client.ts';
import { accounts, blobs, notes, noteTags, sessions, shares, tags, tombstones } from './schema.ts';

/** Paged in primary-key order, so OFFSET pages neither skip nor repeat a row. */
const TABLES: Record<BackupKind, { table: PgTable; key: PgColumn[] }> = {
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
  recordsOf(async (kind, offset) => {
    const rows = await db
      .select()
      .from(TABLES[kind].table)
      .orderBy(...TABLES[kind].key)
      .limit(PAGE)
      .offset(offset);
    return rows.map((row) => withoutNulls(row));
  });

async function isEmpty(db: Db): Promise<boolean> {
  return (await db.select({ id: accounts.id }).from(accounts).limit(1)).length === 0;
}

export function serverBackupOf(db: Db): Store['serverBackup'] {
  return {
    isEmpty: () => isEmpty(db),
    // One snapshot for every read, unlike the READ COMMITTED of transaction(fn).
    read: (fn) =>
      db.transaction((tx) => fn(recordsIn(tx)), {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      }),
    write: (records) =>
      db.transaction(async (tx) => {
        if (!(await isEmpty(tx))) {
          throw new Error('A Server Backup is written only into an empty Store');
        }
        await writeEach(records, (kind, batch) => tx.insert(TABLES[kind].table).values(batch));
      }),
  };
}
