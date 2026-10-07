import { randomUUID } from 'node:crypto';
import type { Clock } from '../../shared/clock.ts';
import { NotFound, Unauthorized } from '../../shared/errors.ts';
import { hashPassword } from '../../shared/passwords.ts';
import type { AccountRecord, Role } from '../../store/records.ts';
import type { Store, StoreTx } from '../../store/Store.ts';
import type { PairingService } from '../pairing/service.ts';

export type SessionAccount = Pick<AccountRecord, 'id' | 'username' | 'role'>;

/** One answer for a wrong username, a wrong password and a bad code, so none can be told apart. */
export const WRONG_CREDENTIALS = 'Wrong credentials';

type NewAccount = { code: string; username: string; password: string };

/** Local Accounts; both kinds are created by spending a Pairing Code (ADR 0001). */
export class AccountService {
  readonly #store: Store;
  readonly #clock: Clock;
  readonly #pairing: PairingService;

  constructor(store: Store, clock: Clock, pairing: PairingService) {
    this.#store = store;
    this.#clock = clock;
    this.#pairing = pairing;
  }

  async createOwner({ code, username, password }: NewAccount): Promise<SessionAccount> {
    await this.#pairing.requireSetup();
    const passwordHash = await hashPassword(password);
    const owner = await this.#store.transaction(async (tx) => {
      if (!(await this.#pairing.spend(code, 'setup', tx))) return null;
      return this.#insert(tx, username, passwordHash, 'owner');
    });
    if (!owner) throw new Unauthorized(WRONG_CREDENTIALS);
    return owner;
  }

  async createMember({ code, username, password }: NewAccount): Promise<SessionAccount> {
    const passwordHash = await hashPassword(password);
    const member = await this.#store.transaction(async (tx) => {
      // Code first, so only a holder of a good Invite learns whether a username is taken.
      if (!(await this.#pairing.spend(code, 'invite', tx))) return null;
      // A taken name throws, which rolls the spend back, so it does not cost the Invite.
      return this.#insert(tx, username, passwordHash, 'member');
    });
    if (!member) throw new Unauthorized(WRONG_CREDENTIALS);
    return member;
  }

  list(): Promise<AccountRecord[]> {
    return this.#store.accounts.list();
  }

  async get(id: string): Promise<AccountRecord> {
    const account = await this.#store.accounts.find(id);
    if (!account) throw new NotFound('No such Account');
    return account;
  }

  /** The Account's Devices stay signed in. */
  async setPassword(id: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    const at = this.#clock().toISOString();
    if (!(await this.#store.accounts.setPassword(id, passwordHash, at))) {
      throw new NotFound('No such Account');
    }
  }

  async find(id: string): Promise<SessionAccount | undefined> {
    const account = await this.#store.accounts.find(id);
    return account && { id: account.id, username: account.username, role: account.role };
  }

  findWithPassword(
    username: string
  ): Promise<(SessionAccount & { passwordHash?: string }) | undefined> {
    return this.#store.accounts.findByUsername(username);
  }

  async #insert(
    store: StoreTx,
    username: string,
    passwordHash: string,
    role: Role
  ): Promise<SessionAccount> {
    const id = randomUUID();
    const createdAt = this.#clock().toISOString();
    await store.accounts.add({ id, username, passwordHash, role, createdAt });
    return { id, username, role };
  }
}
