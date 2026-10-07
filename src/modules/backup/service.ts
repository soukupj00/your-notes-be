import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Clock } from '../../shared/clock.ts';
import type { Warn } from '../../shared/warn.ts';
import type { BlobStore } from '../../store/BlobStore.ts';
import { type AllRecords, BACKUP_KINDS, type BlobRecord, mapKinds } from '../../store/records.ts';
import type { Store } from '../../store/Store.ts';
import { VERSION } from '../../version.ts';
import {
  BLOBS,
  bytesPath,
  type Counts,
  FORMAT_VERSION,
  MANIFEST,
  type Manifest,
  PRIVATE_DIR,
  PRIVATE_FILE,
  readLines,
  readManifest,
  recordsIn,
  writeLines,
} from './format.ts';

export type Server = { store: Store; blobs: BlobStore };

/**
 * The Server Backup (ADR 0006). Records are copied whole, so Devices keep syncing, signed in,
 * without a resync.
 */
export class ServerBackupService {
  readonly #server: Server;
  readonly #clock: Clock;
  readonly #warn: Warn;

  constructor(server: Server, clock: Clock, warn: Warn) {
    this.#server = server;
    this.#clock = clock;
    this.#warn = warn;
  }

  /** The manifest goes last, so a directory without one is incomplete. */
  async backup(dir: string): Promise<Manifest> {
    // Private, files and folders alike: the backup holds Share Link tokens and password hashes.
    await mkdir(dir, { recursive: true, mode: PRIVATE_DIR });
    if ((await readdir(dir)).length > 0) throw new Error(`${dir} is not empty`);
    const counts: Partial<Counts> = {};
    const recorded = await this.#server.store.serverBackup.read(async (records) => {
      for (const kind of BACKUP_KINDS) {
        if (kind !== 'blobRecords') counts[kind] = await writeLines(dir, kind, records[kind]());
      }
      return collect(records.blobRecords());
    });
    // After the snapshot, which no byte copy should hold open.
    await mkdir(join(dir, BLOBS), { mode: PRIVATE_DIR });
    const copied = await this.#copyBytes(recorded, (record, data) => writeBytes(dir, record, data));
    counts.blobRecords = await writeLines(dir, 'blobRecords', copied);
    const manifest: Manifest = {
      formatVersion: FORMAT_VERSION,
      serverVersion: VERSION,
      createdAt: this.#clock().toISOString(),
      counts: Object.fromEntries(BACKUP_KINDS.map((kind) => [kind, counts[kind]])) as Counts,
    };
    await writeFile(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
      mode: PRIVATE_FILE,
    });
    return manifest;
  }

  /** Bytes go in before records, as on upload. */
  async restore(dir: string): Promise<Manifest> {
    const manifest = await readManifest(dir);
    await requireEmpty(this.#server);
    await verify(dir, manifest);
    const { store, blobs } = this.#server;
    await emptiedOnFailure(blobs, async (wrote) => {
      for await (const { id, size } of readLines(dir, 'blobRecords')) {
        await blobs.put(id, createReadStream(bytesPath(dir, id)), size);
        wrote(id);
      }
      await store.serverBackup.write(recordsIn(dir));
    });
    return manifest;
  }

  /**
   * An absent `target.store` or `target.blobs` leaves the records or the bytes where they are. The
   * server must be stopped, or what it writes meanwhile is left behind.
   */
  async migrateTo(target: Partial<Server>): Promise<{ records: number; files: number }> {
    await requireEmpty(target);
    const source = this.#server;
    const recorded = await source.store.serverBackup.read((records) =>
      collect(records.blobRecords())
    );
    return emptiedOnFailure(target.blobs, async (wrote) => {
      const { store, blobs } = target;
      const kept = blobs
        ? await this.#copyBytes(recorded, async ({ id, size }, data) => {
            await blobs.put(id, data, size);
            wrote(id);
          })
        : recorded;
      const seen = { count: 0 };
      if (store) {
        const ids = new Set(kept.map(({ id }) => id));
        // A second snapshot, after the bytes: with the server stopped it holds what the first did.
        await source.store.serverBackup.read((records) =>
          store.serverBackup.write(
            counting({ ...records, blobRecords: () => only(records.blobRecords(), ids) }, seen)
          )
        );
      }
      return { records: seen.count, files: blobs ? kept.length : 0 };
    });
  }

  /** A blob whose bytes are gone, swept since the records were read or lost before, is left out. */
  async #copyBytes(
    records: BlobRecord[],
    put: (record: BlobRecord, data: Readable) => Promise<void>
  ): Promise<BlobRecord[]> {
    const copied: BlobRecord[] = [];
    for (const record of records) {
      const data = await this.#server.blobs.get(record.id);
      if (!data) {
        this.#warn(`Left out blob ${record.id}: it is recorded, but its bytes are gone`);
        continue;
      }
      await put(record, data);
      copied.push(record);
    }
    return copied;
  }
}

async function requireEmpty({ store, blobs }: Partial<Server>): Promise<void> {
  if (store && !(await store.serverBackup.isEmpty())) {
    throw new Error('The database to fill already holds accounts; it must be empty');
  }
  if (blobs && (await blobs.list()).length > 0) {
    throw new Error('The Attachment storage to fill already holds files; it must be empty');
  }
}

async function verify(dir: string, manifest: Manifest): Promise<void> {
  for (const kind of BACKUP_KINDS) {
    const count = (await collect(readLines(dir, kind))).length;
    if (count !== manifest.counts[kind]) {
      throw new Error(
        `${kind}.jsonl holds ${count} records; ${MANIFEST} says ${manifest.counts[kind]}`
      );
    }
  }
  for await (const { id, size } of readLines(dir, 'blobRecords')) {
    const found = await stat(bytesPath(dir, id)).catch(() => undefined);
    if (found?.size !== size) throw new Error(`${BLOBS}/${id} is missing or not ${size} bytes`);
  }
}

/** Runs `fill`; when it fails, removes the bytes it wrote, so a retry finds the target empty. */
async function emptiedOnFailure<T>(
  blobs: BlobStore | undefined,
  fill: (wrote: (id: string) => void) => Promise<T>
): Promise<T> {
  const written: string[] = [];
  try {
    return await fill((id) => written.push(id));
  } catch (error) {
    for (const id of written) await blobs?.delete(id).catch(() => undefined);
    throw error;
  }
}

async function writeBytes(dir: string, { id, size }: BlobRecord, data: Readable): Promise<void> {
  const path = bytesPath(dir, id);
  await pipeline(data, createWriteStream(path, { flags: 'wx', mode: PRIVATE_FILE }));
  const written = (await stat(path)).size;
  if (written !== size) throw new Error(`${BLOBS}/${id}: expected ${size} bytes, read ${written}`);
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
}

async function* only(records: AsyncIterable<BlobRecord>, ids: Set<string>) {
  for await (const record of records) if (ids.has(record.id)) yield record;
}

function counting(records: AllRecords, seen: { count: number }): AllRecords {
  async function* count<T>(items: AsyncIterable<T>) {
    for await (const item of items) {
      seen.count++;
      yield item;
    }
  }
  return mapKinds((kind) => () => count(records[kind]()));
}
