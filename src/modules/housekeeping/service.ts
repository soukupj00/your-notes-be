import { DAY_MS } from '../../shared/clock.ts';
import type { BlobStore } from '../../store/BlobStore.ts';
import type { Store } from '../../store/Store.ts';

export const SWEEP_EVERY_MS = DAY_MS;

/** Daily housekeeping, in process: the server is one instance (ADR 0006). */
export class HousekeepingService {
  readonly #store: Store;
  readonly #blobs: BlobStore;
  readonly #tombstoneDays: number;

  constructor(store: Store, blobs: BlobStore, tombstoneDays: number) {
    this.#store = store;
    this.#blobs = blobs;
    this.#tombstoneDays = tombstoneDays;
  }

  /** For `/health`: fails when the database does. */
  ping(): Promise<void> {
    return this.#store.ping();
  }

  /**
   * Each Account's pruned Sequence rises to the newest Tombstone removed, so an older cursor gets
   * 410 (PLAN.md "Sync rules").
   */
  async sweep(now: Date): Promise<void> {
    const at = now.toISOString();
    const cutoff = new Date(now.getTime() - this.#tombstoneDays * DAY_MS).toISOString();
    await this.#store.transaction(async ({ housekeeping }) => {
      await housekeeping.pruneTombstones(cutoff);
      await housekeeping.removeExpiredSessions(at);
      await housekeeping.removeDeadCodes(at);
      // A Share Link outlives its purged Note only until here; the public route already hides it.
      await housekeeping.removeOrphanShares();
    });
    await this.#sweepBlobs(now);
  }

  /**
   * Bytes no Note references for a day go (a purged Note's too), file before record; so do files
   * a crash left without a record.
   */
  async #sweepBlobs(now: Date): Promise<void> {
    // Listed before the records are read, so an upload finishing meanwhile is seen with its record.
    const files = await this.#blobs.list();
    const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
    for (const id of await this.#store.housekeeping.unreferencedBlobs(cutoff)) {
      await this.#blobs.delete(id);
      await this.#store.blobRecords.remove(id);
    }
    const recorded = new Set(await this.#store.blobRecords.ids());
    for (const id of files) if (!recorded.has(id)) await this.#blobs.delete(id);
  }
}
