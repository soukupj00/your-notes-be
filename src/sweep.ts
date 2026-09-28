import { eq, isNotNull, lt, lte, max, or, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { accounts, codes, sessions, tombstones } from './db/schema.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily sweep in one transaction: Tombstones past the window go, and each Account's
 * `pruned_seq` rises to the newest one removed, so an older cursor gets 410 (PLAN.md "Sync rules");
 * expired Sessions and spent or expired Pairing Codes go too. B4 adds the orphan blob sweep.
 */
export function sweep(db: Db, now: Date, tombstoneDays: number): void {
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
  })();
}

export const SWEEP_EVERY_MS = DAY_MS;
