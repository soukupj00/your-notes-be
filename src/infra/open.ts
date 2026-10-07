import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Config } from '../config.ts';
import type { Warn } from '../shared/warn.ts';
import type { BlobStore } from '../store/BlobStore.ts';
import type { Store } from '../store/Store.ts';
import { diskBlobStore } from './blobs/disk.ts';
import type { PostgresOptions } from './postgres/store.ts';
import { openSqliteStore } from './sqlite/store.ts';

// Non-default backends load by dynamic import, so a SQLite and disk install never loads their
// drivers (ADR 0006). No switch has a default case, so tsc names each one to extend.

/** Migrated before it returns. */
export async function openStore(config: Config, options: PostgresOptions): Promise<Store> {
  switch (config.database.kind) {
    case 'postgres': {
      const { openPostgresStore } = await import('./postgres/store.ts');
      return openPostgresStore(config.database.url, options);
    }
    case 'sqlite':
      mkdirSync(config.dataDir, { recursive: true });
      return openSqliteStore(sqlitePath(config.dataDir));
  }
}

export function sqlitePath(dataDir: string): string {
  return join(dataDir, 'younotes.db');
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
    case 's3':
      return `s3 ${config.blobStore.endpoint ?? 'aws'} ${config.blobStore.bucket}`;
    case 'disk':
      return resolve(config.dataDir, 'blobs');
  }
}
