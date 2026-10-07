import { DAY_MS } from '../../shared/clock.ts';
import type { BlobStore } from '../../store/BlobStore.ts';
import type { Store } from '../../store/Store.ts';

export const SWEEP_EVERY_MS = DAY_MS;

/** Daily housekeeping, in process: the server is one instance (ADR 0006). */
export class HousekeepingService {
  readonly #store: Store;
  readonly #blobs: BlobStore;
  readonly #tombstoneDays: number;
  // Deleted on the second sighting, so an upload between its bytes and its record is never swept.
  #orphansSeen = new Set<string>();

  constructor(store: Store, blobs: BlobStore, tombstoneDays: number) {
    this.#store = store;
    this.#blobs = blobs;
    this.#tombstoneDays = tombstoneDays;
  }

  ping(): Promise<void> {
    return this.#store.ping();
  }

  /**
   * Removing Tombstones raises each Account's pruned Sequence; a cursor below it gets 410.
   * With `idle`, no upload can be in flight, so a file without a record goes on first sight.
   */
  async sweep(now: Date, idle = false): Promise<void> {
    const at = now.toISOString();
    const cutoff = new Date(now.getTime() - this.#tombstoneDays * DAY_MS).toISOString();
    await this.#store.transaction(async ({ housekeeping }) => {
      await housekeeping.pruneTombstones(cutoff);
      await housekeeping.removeExpiredSessions(at);
      await housekeeping.removeDeadCodes(at);
      // A Share Link outlives its purged Note only until here; the public route already hides it.
      await housekeeping.removeOrphanShares();
    });
    await this.#sweepBlobs(now, idle);
  }

  /** A purged Note's bytes leave this way; so do files a crash left without a record. */
  async #sweepBlobs(now: Date, idle: boolean): Promise<void> {
    // Listed before the records are read, so an upload finishing meanwhile is seen with its record.
    const files = await this.#blobs.list();
    const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
    for (const id of await this.#store.housekeeping.unreferencedBlobs(cutoff)) {
      // Record first: a crash between the two leaves a file, never a record vouching for nothing.
      await this.#store.blobRecords.remove(id);
      await this.#blobs.delete(id);
    }
    const recorded = new Set(await this.#store.blobRecords.ids());
    const orphans = files.filter((id) => !recorded.has(id));
    for (const id of orphans) if (idle || this.#orphansSeen.has(id)) await this.#blobs.delete(id);
    this.#orphansSeen = idle
      ? new Set()
      : new Set(orphans.filter((id) => !this.#orphansSeen.has(id)));
  }
}
