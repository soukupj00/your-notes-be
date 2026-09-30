import type { Readable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import type { BlobStore } from '../../blobs/BlobStore.ts';
import type { Db } from '../../db/client.ts';
import { blobs } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { NotFound } from '../../shared/errors.ts';

export type BlobRow = typeof blobs.$inferSelect;

/** Attachment bytes, write-once by id (frontend ADR 0017). */
export class BlobService {
  readonly #db: Db;
  readonly #store: BlobStore;
  readonly #clock: Clock;

  constructor(db: Db, store: BlobStore, clock: Clock) {
    this.#db = db;
    this.#store = store;
    this.#clock = clock;
  }

  /** Whether an upload to `id` is refused, already done, or wanted. */
  async uploadState(accountId: string, id: string): Promise<'foreign' | 'stored' | 'wanted'> {
    const row = this.#db.select().from(blobs).where(eq(blobs.id, id)).get();
    if (row && row.accountId !== accountId) return 'foreign';
    // A row whose file is missing takes the upload again, so a lost file can be healed.
    return row && (await this.#store.has(id)) ? 'stored' : 'wanted';
  }

  async upload(
    accountId: string,
    id: string,
    data: Readable,
    size: number,
    mime: string
  ): Promise<void> {
    await this.#store.put(id, data, size);
    // File first, row second: a crash between them leaves a file the sweep removes.
    this.#db
      .insert(blobs)
      .values({ id, accountId, size, mime, createdAt: this.#clock().toISOString() })
      .onConflictDoNothing()
      .run();
  }

  find(accountId: string, id: string): BlobRow | undefined {
    return this.#db
      .select()
      .from(blobs)
      .where(and(eq(blobs.id, id), eq(blobs.accountId, accountId)))
      .get();
  }

  /** Another Account's id is as unknown as one that does not exist. */
  mine(accountId: string, id: string): BlobRow {
    const row = this.find(accountId, id);
    if (!row) throw new NotFound('No such blob');
    return row;
  }

  bytes(id: string): Promise<Readable | undefined> {
    return this.#store.get(id);
  }
}
