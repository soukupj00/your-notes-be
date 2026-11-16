import { randomUUID } from 'node:crypto';
import type { Clock } from '../../shared/clock.ts';
import { NotFound, Unauthorized } from '../../shared/errors.ts';
import { hashPassword } from '../../shared/passwords.ts';
import type { AccountRecord, CodeKind, Role } from '../../store/records.ts';
import type { Store } from '../../store/Store.ts';
import type { PairingService } from '../pairing/service.ts';

export type SessionAccount = Pick<AccountRecord, 'id' | 'username' | 'role'>;

/** Copies only these three, so a password hash or other columns never ride along. */
export function toSessionAccount(
  record: Pick<AccountRecord, 'id' | 'username' | 'role'>
): SessionAccount {
  return { id: record.id, username: record.username, role: record.role };
}

/** One answer for a wrong username, a wrong password and a bad code, so none can be told apart. */
export const WRONG_CREDENTIALS = 'Wrong credentials';

type NewAccount = { code: string; username: string; password: string };

const CODE_FOR: Record<Role, CodeKind> = { owner: 'setup', member: 'invite' };

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

  async createOwner(account: NewAccount): Promise<SessionAccount> {
    await this.#pairing.requireSetup();
    return this.#create(account, 'owner');
  }

  createMember(account: NewAccount): Promise<SessionAccount> {
    return this.#create(account, 'member');
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
    return account && toSessionAccount(account);
  }

  findWithPassword(
    username: string
  ): Promise<(SessionAccount & { passwordHash?: string }) | undefined> {
    return this.#store.accounts.findByUsername(username);
  }

  async #create({ code, username, password }: NewAccount, role: Role): Promise<SessionAccount> {
    const passwordHash = await hashPassword(password);
    const created = await this.#store.transaction(async (tx) => {
      // Code first, so only a holder of a good code learns whether a username is taken.
      if (!(await this.#pairing.spend(code, CODE_FOR[role], tx))) return null;
      const id = randomUUID();
      const createdAt = this.#clock().toISOString();
      // A taken name throws, which rolls the spend back, so it does not cost the code.
      await tx.accounts.add({ id, username, passwordHash, role, createdAt });
      return { id, username, role };
    });
    if (!created) throw new Unauthorized(WRONG_CREDENTIALS);
    return created;
  }
}
