import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Config } from '../config.ts';
import type { Warn } from '../shared/warn.ts';
import type { BlobStore } from '../store/BlobStore.ts';
import type { Store } from '../store/Store.ts';
import { diskBlobStore } from './blobs/disk.ts';
import type { PostgresOptions } from './postgres/store.ts';
import { openSqliteStore } from './sqlite/store.ts';

// A non-default backend loads only when chosen, so a SQLite and disk install never loads pg or
// the AWS SDK (ADR 0006). No switch has a default case: tsc fails until each names a new backend.

/** The SQLite file in DATA_DIR, unless DATABASE_URL names a PostgreSQL; migrated either way. */
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

/** Files in DATA_DIR, unless BLOB_STORE=s3; `warn` hears of each try while the bucket is not up. */
export async function openBlobStore(config: Config, warn: Warn): Promise<BlobStore> {
  switch (config.blobStore.kind) {
    case 's3':
      return (await import('./blobs/s3.ts')).s3BlobStore(config.blobStore, warn);
    case 'disk':
      return diskBlobStore(join(config.dataDir, 'blobs'));
  }
}

// Where a Config keeps records and bytes, compared by `migrate` to move only what changes place.
// Two spellings of one place (localhost, 127.0.0.1) compare unequal, which is safe: migrate then
// finds the target holding data, or locked on PostgreSQL, and refuses.

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
