import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Config } from '../config.ts';
import type { Warn } from '../shared/warn.ts';
import type { BlobStore } from '../store/BlobStore.ts';
import type { Store } from '../store/Store.ts';
import { diskBlobStore } from './blobs/disk.ts';
import { holdInstanceLock } from './sqlite/instanceLock.ts';
import { openSqliteStore } from './sqlite/store.ts';

// Non-default backends load by dynamic import, so a SQLite and disk install never loads their
// drivers (ADR 0006). No switch has a default case, so tsc names each one to extend.

export type StoreOptions = {
  /** Told of every try while PostgreSQL is not up yet, and of its dropped connections. */
  warn: Warn;
  /**
   * Hold the one-instance lock (ADR 0006) from before migrating until `close`; `onLost` hears if
   * the PostgreSQL connection holding it drops, which SQLite's lock cannot.
   */
  oneInstance?: { onLost(error: Error): void };
};

/** Migrated before it returns. */
export async function openStore(config: Config, options: StoreOptions): Promise<Store> {
  switch (config.database.kind) {
    case 'postgres': {
      const { openPostgresStore } = await import('./postgres/store.ts');
      return openPostgresStore(config.database.url, options);
    }
    case 'sqlite': {
      mkdirSync(config.dataDir, { recursive: true });
      const release = options.oneInstance ? holdInstanceLock(config.dataDir) : () => {};
      try {
        return openSqliteStore(sqlitePath(config.dataDir), release);
      } catch (error) {
        release();
        throw error;
      }
    }
  }
}

export function sqlitePath(dataDir: string): string {
  return join(dataDir, 'yournotes.db');
}

/** `warn` hears of each try while the S3 bucket is not up. */
export async function openBlobStore(config: Config, warn: Warn): Promise<BlobStore> {
  switch (config.blobStore.kind) {
    case 's3':
      return (await import('./blobs/s3.ts')).s3BlobStore(config.blobStore, warn);
    case 'disk':
      return diskBlobStore(join(config.dataDir, 'blobs'));
  }
}

// Compared by `migrate` to move only what changes place. Two spellings of one place compare
// unequal, which is safe: migrate then finds the target full, or locked, and refuses.

export function storeLocation(config: Config): string {
  switch (config.database.kind) {
    case 'postgres':
      return config.database.url;
    case 'sqlite':
      return resolve(sqlitePath(config.dataDir));
  }
}

export function blobStoreLocation(config: Config): string {
  switch (config.blobStore.kind) {
    case 's3': {
      const { endpoint, bucket, prefix } = config.blobStore;
      return `s3 ${endpoint ?? 'aws'} ${bucket}/${prefix}`;
    }
    case 'disk':
      return resolve(config.dataDir, 'blobs');
  }
}
