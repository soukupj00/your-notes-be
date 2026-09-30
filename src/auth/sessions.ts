import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { Db } from '../db/client.ts';
import { accounts, sessions } from '../db/schema.ts';
import { DAY_MS } from '../shared/clock.ts';
import { newSecret, sha256 } from '../shared/crypto.ts';

export const SESSION_COOKIE = 'younotes_session';

const TOUCH_EVERY_MS = 5 * 60 * 1000;

export type SessionAccount = { id: string; username: string; role: 'owner' | 'member' };
export type SessionDevice = { id: string; name: string };

export const sessionAccountColumns = {
  id: accounts.id,
  username: accounts.username,
  role: accounts.role,
};

/** One row per Device: the Session's id is the Device's id. Returns the cookie value. */
export function createSession(
  db: Db,
  {
    accountId,
    deviceName,
    ttlDays,
    now,
  }: {
    accountId: string;
    deviceName: string;
    ttlDays: number;
    now: Date;
  }
): { token: string; deviceId: string } {
  const token = newSecret();
  const deviceId = randomUUID();
  const at = now.toISOString();
  db.insert(sessions)
    .values({
      id: deviceId,
      accountId,
      tokenHash: sha256(token),
      deviceName,
      createdAt: at,
      lastSeenAt: at,
      expiresAt: new Date(now.getTime() + ttlDays * DAY_MS).toISOString(),
    })
    .run();
  return { token, deviceId };
}

/** An expired Session is deleted on sight. */
export function resolveSession(
  db: Db,
  token: string,
  now: Date
): { account: SessionAccount; device: SessionDevice } | null {
  const row = db
    .select({
      id: sessions.id,
      name: sessions.deviceName,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      accountId: accounts.id,
      username: accounts.username,
      role: accounts.role,
    })
    .from(sessions)
    .innerJoin(accounts, eq(accounts.id, sessions.accountId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .get();
  if (!row) return null;
  if (row.expiresAt <= now.toISOString()) {
    db.delete(sessions).where(eq(sessions.id, row.id)).run();
    return null;
  }
  if (now.getTime() - Date.parse(row.lastSeenAt) >= TOUCH_EVERY_MS) {
    db.update(sessions).set({ lastSeenAt: now.toISOString() }).where(eq(sessions.id, row.id)).run();
  }
  return {
    account: { id: row.accountId, username: row.username, role: row.role },
    device: { id: row.id, name: row.name },
  };
}

const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

export function setSessionCookie(reply: FastifyReply, token: string, ttlDays: number): void {
  reply.setCookie(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: (ttlDays * DAY_MS) / 1000 });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
}
