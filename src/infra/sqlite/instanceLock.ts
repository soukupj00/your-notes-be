import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

// A collected connection closes itself, so the lock would end with the last reference to it.
const held = new Set<Database.Database>();

/** Holds `dataDir`'s one-instance lock (ADR 0006) until released; throws if another holds it. */
export function holdInstanceLock(dataDir: string): () => void {
  // A kernel lock, not a pid file, so a crash never blocks the next start (transactions.md).
  const path = join(dataDir, 'younotes.lock');
  // SQLite opens a file it cannot write read-only, where BEGIN EXCLUSIVE locks nothing.
  closeSync(openSync(path, 'a'));
  const lock = new Database(path, { timeout: 0 });
  try {
    // Nothing is ever written, so no journal file need sit beside it, nor outlive a crash.
    lock.pragma('journal_mode = MEMORY');
    lock.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    lock.close();
    if ((error as { code?: string }).code !== 'SQLITE_BUSY') throw error;
    throw new Error(
      `Another YourNotes server is already using ${dataDir}; ` +
        'only one may run at a time, so stop the other first'
    );
  }
  held.add(lock);
  return () => {
    held.delete(lock);
    lock.close();
  };
}
