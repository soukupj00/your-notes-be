import { randomUUID } from 'node:crypto';
import type { SignInRequest } from '../../contract/index.ts';
import { type Clock, DAY_MS } from '../../shared/clock.ts';
import { newSecret, sha256 } from '../../shared/crypto.ts';
import { NotFound, Unauthorized } from '../../shared/errors.ts';
import { verifyPassword } from '../../shared/passwords.ts';
import type { SessionRecord } from '../../store/records.ts';
import type { Store } from '../../store/Store.ts';
import {
  type AccountService,
  type SessionAccount,
  WRONG_CREDENTIALS,
} from '../accounts/service.ts';
import type { PairingService } from '../pairing/service.ts';

const TOUCH_EVERY_MS = 5 * 60 * 1000;

export type SessionDevice = { id: string; name: string };
/** `token` is the cookie value; only its SHA-256 is stored. */
export type OpenedSession = { token: string; account: SessionAccount; device: SessionDevice };

/** One Session per Device; a Device is a Session seen from the person's side. */
export class SessionService {
  readonly #store: Store;
  readonly #clock: Clock;
  readonly #accounts: AccountService;
  readonly #pairing: PairingService;
  readonly #ttlDays: number;

  constructor(
    store: Store,
    clock: Clock,
    accounts: AccountService,
    pairing: PairingService,
    ttlDays: number
  ) {
    this.#store = store;
    this.#clock = clock;
    this.#accounts = accounts;
    this.#pairing = pairing;
    this.#ttlDays = ttlDays;
  }

  async signIn(body: SignInRequest): Promise<OpenedSession> {
    let account: SessionAccount | undefined;
    if ('password' in body) {
      const row = await this.#accounts.findWithPassword(body.username);
      // Exactly one scrypt either way, so a wrong username costs what a wrong password does.
      const ok = await verifyPassword(body.password, row?.passwordHash);
      if (row && ok) account = { id: row.id, username: row.username, role: row.role };
    } else {
      const spent = await this.#pairing.spend(body.code, 'device');
      if (spent?.accountId) account = await this.#accounts.find(spent.accountId);
    }
    if (!account) throw new Unauthorized(WRONG_CREDENTIALS);
    return this.open(account, body.deviceName);
  }

  async open(account: SessionAccount, deviceName: string): Promise<OpenedSession> {
    const now = this.#clock();
    const token = newSecret();
    const deviceId = randomUUID();
    const at = now.toISOString();
    await this.#store.sessions.add({
      id: deviceId,
      accountId: account.id,
      tokenHash: sha256(token),
      deviceName,
      createdAt: at,
      lastSeenAt: at,
      expiresAt: new Date(now.getTime() + this.#ttlDays * DAY_MS).toISOString(),
    });
    return { token, account, device: { id: deviceId, name: deviceName } };
  }

  /** An expired Session is deleted on sight. */
  async resolve(token: string): Promise<{ account: SessionAccount; device: SessionDevice } | null> {
    const now = this.#clock();
    const found = await this.#store.sessions.findByTokenHash(sha256(token));
    if (!found) return null;
    const { session, account } = found;
    if (session.expiresAt <= now.toISOString()) {
      await this.#store.sessions.remove(session.id);
      return null;
    }
    if (now.getTime() - Date.parse(session.lastSeenAt) >= TOUCH_EVERY_MS) {
      await this.#store.sessions.touch(session.id, now.toISOString());
    }
    return {
      account: { id: account.id, username: account.username, role: account.role },
      device: { id: session.id, name: session.deviceName },
    };
  }

  end(deviceId: string): Promise<void> {
    return this.#store.sessions.remove(deviceId);
  }

  devices(accountId: string): Promise<SessionRecord[]> {
    return this.#store.sessions.listLive(accountId, this.#clock().toISOString());
  }

  async revoke(accountId: string, deviceId: string): Promise<void> {
    if (!(await this.#store.sessions.removeOwned(accountId, deviceId))) {
      throw new NotFound('No such Device');
    }
  }
}
