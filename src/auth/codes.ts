import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { accounts, codes } from '../db/schema.ts';

export type CodeKind = 'setup' | 'device' | 'invite';

export const CODE_TTL_MS = 10 * 60 * 1000;

/** A `setup` code does not expire by the clock; it dies when used or when the server restarts. */
const NEVER = '9999-12-31T23:59:59.999Z';

/** 32 random bytes, base64url: the shape of every secret the server hands out. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Secrets are stored only as their SHA-256, so a leaked database cannot sign anyone in. */
export function sha256(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function mintCode(
  db: Db,
  kind: CodeKind,
  accountId: string | null,
  now: Date
): { code: string; expiresAt: string } {
  const code = newSecret();
  const expiresAt = kind === 'setup' ? NEVER : new Date(now.getTime() + CODE_TTL_MS).toISOString();
  db.insert(codes)
    .values({ codeHash: sha256(code), kind, accountId, createdAt: now.toISOString(), expiresAt })
    .run();
  return { code, expiresAt };
}

/**
 * Marks an unused, unexpired code of this kind as used and returns the Account it carries,
 * or null when there is no such code. A code of another kind is left untouched.
 */
export function spendCode(
  db: Db,
  code: string,
  kind: CodeKind,
  now: Date
): { accountId: string | null } | null {
  const at = now.toISOString();
  const spent = db
    .update(codes)
    .set({ usedAt: at })
    .where(
      and(
        eq(codes.codeHash, sha256(code)),
        eq(codes.kind, kind),
        isNull(codes.usedAt),
        gt(codes.expiresAt, at)
      )
    )
    .returning({ accountId: codes.accountId })
    .get();
  return spent ?? null;
}

export function ownerExists(db: Db): boolean {
  return (
    db.select({ id: accounts.id }).from(accounts).where(eq(accounts.role, 'owner')).get() != null
  );
}

/** At startup: while there is no Owner, replaces any earlier setup code with a fresh one. */
export function ensureSetupCode(db: Db, now: Date): string | null {
  if (ownerExists(db)) return null;
  db.delete(codes).where(eq(codes.kind, 'setup')).run();
  return mintCode(db, 'setup', null, now).code;
}
