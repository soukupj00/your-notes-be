import { join } from 'node:path';
import Database from 'better-sqlite3';

// A collected connection closes itself, so the lock would end with the last reference to it.
const held = new Set<Database.Database>();

/**
 * Holds the one-instance lock on `dataDir` (ADR 0006) until the returned release is called;
 * throws when another server or command holds it.
 */
export function holdInstanceLock(dataDir: string): () => void {
  // A kernel lock rather than a pid in a file: it dies with its process, and a container's
  // server is pid 1 on every start, so a pid cannot tell a crashed server from a running one.
  const lock = new Database(join(dataDir, 'younotes.lock'), { timeout: 0 });
  try {
    // Nothing is ever written, so no journal file need sit beside it, nor outlive a crash.
    lock.pragma('journal_mode = MEMORY');
    lock.exec('BEGIN EXCLUSIVE');
  } catch (error) {
    lock.close();
    if ((error as { code?: string }).code !== 'SQLITE_BUSY') throw error;
    throw new Error(
      `Another YouNotes server is already using ${dataDir}; ` +
        'only one may run at a time, so stop the other first'
    );
  }
  held.add(lock);
  return () => {
    held.delete(lock);
    lock.close();
  };
}
