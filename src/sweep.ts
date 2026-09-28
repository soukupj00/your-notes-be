import { eq, isNotNull, lt, lte, max, or, sql } from 'drizzle-orm';
import type { BlobStore } from './blobs/BlobStore.ts';
import type { Db } from './db/client.ts';
import { accounts, blobs, codes, notes, sessions, shares, tombstones } from './db/schema.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily housekeeping. In one transaction: Tombstones past the window go, and each Account's
 * `pruned_seq` rises to the newest one removed, so an older cursor gets 410 (PLAN.md "Sync rules");
 * expired Sessions, spent or expired Pairing Codes, and Share Links of purged Notes go too.
 * Then the blobs (`sweepBlobs`).
 */
export async function sweep(
  db: Db,
  store: BlobStore,
  now: Date,
  tombstoneDays: number
): Promise<void> {
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - tombstoneDays * DAY_MS).toISOString();
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
        select 1 from ${notes} n where n.account_id = ${shares.accountId} and n.id = ${shares.noteId}
      )`);
  })();
  await sweepBlobs(db, store, now);
}

/**
 * Bytes no Note of their Account references for 24 hours go, file first, then row; a purged
 * Note's bytes leave this way. Files with no row at all (a crash between the two writes) go too.
 */
async function sweepBlobs(db: Db, store: BlobStore, now: Date): Promise<void> {
  // Listed before the rows are read, so an upload finishing meanwhile is seen with its row.
  const files = await store.list();
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  const unreferenced = db.all<{ id: string }>(sql`
    select b.id from ${blobs} b
    where b.created_at < ${cutoff}
      and not exists (
        select 1 from notes n, json_each(n.attachments) a
        where n.account_id = b.account_id and json_extract(a.value, '$.id') = b.id
      )`);
  for (const { id } of unreferenced) {
    await store.delete(id);
    db.delete(blobs).where(eq(blobs.id, id)).run();
  }
  const rows = new Set(
    db
      .select({ id: blobs.id })
      .from(blobs)
      .all()
      .map((row) => row.id)
  );
  for (const id of files) if (!rows.has(id)) await store.delete(id);
}

export const SWEEP_EVERY_MS = DAY_MS;
