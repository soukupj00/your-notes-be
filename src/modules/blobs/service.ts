import type { Readable } from 'node:stream';
import type { Clock } from '../../shared/clock.ts';
import { NotFound } from '../../shared/errors.ts';
import type { BlobStore } from '../../store/BlobStore.ts';
import type { BlobRecord } from '../../store/records.ts';
import type { Store } from '../../store/Store.ts';

/** Attachment bytes, write-once by id (frontend ADR 0017). */
export class BlobService {
  readonly #store: Store;
  readonly #blobs: BlobStore;
  readonly #clock: Clock;

  constructor(store: Store, blobs: BlobStore, clock: Clock) {
    this.#store = store;
    this.#blobs = blobs;
    this.#clock = clock;
  }

  async uploadState(accountId: string, id: string): Promise<'foreign' | 'stored' | 'wanted'> {
    const record = await this.#store.blobRecords.find(id);
    if (record && record.accountId !== accountId) return 'foreign';
    // A record whose file is missing takes the upload again, so a lost file can be healed.
    return record && (await this.#blobs.has(id)) ? 'stored' : 'wanted';
  }

  async upload(
    accountId: string,
    id: string,
    data: Readable,
    size: number,
    mime: string
  ): Promise<void> {
    await this.#blobs.put(id, data, size);
    // File first, record second: a crash between them leaves a file the sweep removes.
    await this.#store.blobRecords.add({
      id,
      accountId,
      size,
      mime,
      createdAt: this.#clock().toISOString(),
    });
  }

  find(accountId: string, id: string): Promise<BlobRecord | undefined> {
    return this.#store.blobRecords.findOwned(accountId, id);
  }

  /** Another Account's id is as unknown as one that does not exist. */
  async mine(accountId: string, id: string): Promise<BlobRecord> {
    const record = await this.find(accountId, id);
    if (!record) throw new NotFound('No such blob');
    return record;
  }

  has(id: string): Promise<boolean> {
    return this.#blobs.has(id);
  }

  bytes(id: string): Promise<Readable | undefined> {
    return this.#blobs.get(id);
  }
}
