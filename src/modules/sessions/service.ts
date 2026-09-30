import { randomUUID } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { SignInRequest } from '../../contract/index.ts';
import type { Db } from '../../db/client.ts';
import { accounts, sessions } from '../../db/schema.ts';
import { type Clock, DAY_MS } from '../../shared/clock.ts';
import { newSecret, sha256 } from '../../shared/crypto.ts';
import { NotFound, Unauthorized } from '../../shared/errors.ts';
import { verifyPassword } from '../../shared/passwords.ts';
import { type AccountService, WRONG_CREDENTIALS } from '../accounts/service.ts';
import type { PairingService } from '../pairing/service.ts';

const TOUCH_EVERY_MS = 5 * 60 * 1000;

export type SessionAccount = { id: string; username: string; role: 'owner' | 'member' };
export type SessionDevice = { id: string; name: string };
export type DeviceRow = typeof sessions.$inferSelect;
/** `token` is the cookie value; only its SHA-256 is stored. */
export type OpenedSession = { token: string; account: SessionAccount; device: SessionDevice };

/** One Session per Device; a Device is a Session seen from the person's side. */
export class SessionService {
  readonly #db: Db;
  readonly #clock: Clock;
  readonly #accounts: AccountService;
  readonly #pairing: PairingService;
  readonly #ttlDays: number;

  constructor(
    db: Db,
    clock: Clock,
    accounts: AccountService,
    pairing: PairingService,
    ttlDays: number
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#accounts = accounts;
    this.#pairing = pairing;
    this.#ttlDays = ttlDays;
  }

  async signIn(body: SignInRequest): Promise<OpenedSession> {
    let account: SessionAccount | undefined;
    if ('password' in body) {
      const row = this.#accounts.findWithPassword(body.username);
      // Exactly one scrypt either way, so a wrong username costs what a wrong password does.
      const ok = await verifyPassword(body.password, row?.passwordHash);
      if (row && ok) account = { id: row.id, username: row.username, role: row.role };
    } else {
      const spent = this.#pairing.spend(body.code, 'device');
      if (spent?.accountId) account = this.#accounts.find(spent.accountId);
    }
    if (!account) throw new Unauthorized(WRONG_CREDENTIALS);
    return this.open(account, body.deviceName);
  }

  /** The Session's id is the Device's id. */
  open(account: SessionAccount, deviceName: string): OpenedSession {
    const now = this.#clock();
    const token = newSecret();
    const deviceId = randomUUID();
    const at = now.toISOString();
    this.#db
      .insert(sessions)
      .values({
        id: deviceId,
        accountId: account.id,
        tokenHash: sha256(token),
        deviceName,
        createdAt: at,
        lastSeenAt: at,
        expiresAt: new Date(now.getTime() + this.#ttlDays * DAY_MS).toISOString(),
      })
      .run();
    return { token, account, device: { id: deviceId, name: deviceName } };
  }

  /** An expired Session is deleted on sight. */
  resolve(token: string): { account: SessionAccount; device: SessionDevice } | null {
    const now = this.#clock();
    const row = this.#db
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
      this.#db.delete(sessions).where(eq(sessions.id, row.id)).run();
      return null;
    }
    if (now.getTime() - Date.parse(row.lastSeenAt) >= TOUCH_EVERY_MS) {
      this.#db
        .update(sessions)
        .set({ lastSeenAt: now.toISOString() })
        .where(eq(sessions.id, row.id))
        .run();
    }
    return {
      account: { id: row.accountId, username: row.username, role: row.role },
      device: { id: row.id, name: row.name },
    };
  }

  end(deviceId: string): void {
    this.#db.delete(sessions).where(eq(sessions.id, deviceId)).run();
  }

  devices(accountId: string): DeviceRow[] {
    const now = this.#clock().toISOString();
    return this.#db
      .select()
      .from(sessions)
      .where(and(eq(sessions.accountId, accountId), gt(sessions.expiresAt, now)))
      .orderBy(sessions.createdAt)
      .all();
  }

  revoke(accountId: string, deviceId: string): void {
    const deleted = this.#db
      .delete(sessions)
      .where(and(eq(sessions.id, deviceId), eq(sessions.accountId, accountId)))
      .returning({ id: sessions.id })
      .get();
    if (!deleted) throw new NotFound('No such Device');
  }
}
