import { eq, isNotNull, lt, lte, max, or, sql } from 'drizzle-orm';
import type { BlobStore } from '../../blobs/BlobStore.ts';
import type { Db } from '../../db/client.ts';
import { accounts, blobs, codes, notes, sessions, shares, tombstones } from '../../db/schema.ts';
import { DAY_MS } from '../../shared/clock.ts';

export const SWEEP_EVERY_MS = DAY_MS;

/** Daily housekeeping, in process: the server is one instance (ADR 0006). */
export class HousekeepingService {
  readonly #db: Db;
  readonly #store: BlobStore;
  readonly #tombstoneDays: number;

  constructor(db: Db, store: BlobStore, tombstoneDays: number) {
    this.#db = db;
    this.#store = store;
    this.#tombstoneDays = tombstoneDays;
  }

  /**
   * Each Account's `pruned_seq` rises to the newest Tombstone removed, so an older cursor gets
   * 410 (PLAN.md "Sync rules").
   */
  async sweep(now: Date): Promise<void> {
    const db = this.#db;
    const at = now.toISOString();
    const cutoff = new Date(now.getTime() - this.#tombstoneDays * DAY_MS).toISOString();
    const old = lt(tombstones.deletedAt, cutoff);
    db.$client.transaction(() => {
      const removed = db
        .select({ accountId: tombstones.accountId, seq: max(tombstones.seq) })
        .from(tombstones)
        .where(old)
        .groupBy(tombstones.accountId)
        .all();
      for (const { accountId, seq } of removed) {
        if (seq === null) continue;
        db.update(accounts)
          .set({ prunedSeq: sql`max(${accounts.prunedSeq}, ${seq})` })
          .where(eq(accounts.id, accountId))
          .run();
      }
      db.delete(tombstones).where(old).run();
      db.delete(sessions).where(lte(sessions.expiresAt, at)).run();
      db.delete(codes)
        .where(or(isNotNull(codes.usedAt), lte(codes.expiresAt, at)))
        .run();
      // A Share Link outlives its purged Note only until here; the public route already hides it.
      db.run(sql`
        delete from ${shares} where not exists (
          select 1 from ${notes} n
          where n.account_id = ${shares.accountId} and n.id = ${shares.noteId}
        )`);
    })();
    await this.#sweepBlobs(now);
  }

  /**
   * Bytes no Note references for a day go (a purged Note's too), file before row; so do files
   * a crash left without a row.
   */
  async #sweepBlobs(now: Date): Promise<void> {
    const db = this.#db;
    // Listed before the rows are read, so an upload finishing meanwhile is seen with its row.
    const files = await this.#store.list();
    const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
    const unreferenced = db.all<{ id: string }>(sql`
      select b.id from ${blobs} b
      where b.created_at < ${cutoff}
        and not exists (
          select 1 from notes n, json_each(n.attachments) a
          where n.account_id = b.account_id
            and b.id in (json_extract(a.value, '$.id'), json_extract(a.value, '$.thumbnailId'))
        )`);
    for (const { id } of unreferenced) {
      await this.#store.delete(id);
      db.delete(blobs).where(eq(blobs.id, id)).run();
    }
    const rows = new Set(
      db
        .select({ id: blobs.id })
        .from(blobs)
        .all()
        .map((row) => row.id)
    );
    for (const id of files) if (!rows.has(id)) await this.#store.delete(id);
  }
}
