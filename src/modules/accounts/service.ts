import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Account } from '../../contract/index.ts';
import type { Db } from '../../db/client.ts';
import { accounts } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { Conflict, NotFound, Unauthorized } from '../../shared/errors.ts';
import { hashPassword } from '../../shared/passwords.ts';
import type { PairingService } from '../pairing/service.ts';
import type { SessionAccount } from '../sessions/service.ts';

/** One answer for a wrong username, a wrong password and a bad code, so none can be told apart. */
export const WRONG_CREDENTIALS = 'Wrong credentials';

export type AccountRow = Omit<Account, '_links'>;

type NewAccount = { code: string; username: string; password: string };

const sessionAccountColumns = { id: accounts.id, username: accounts.username, role: accounts.role };
const accountColumns = { ...sessionAccountColumns, createdAt: accounts.createdAt };

/** Local Accounts; both kinds are created by spending a Pairing Code (ADR 0001). */
export class AccountService {
  readonly #db: Db;
  readonly #clock: Clock;
  readonly #pairing: PairingService;

  constructor(db: Db, clock: Clock, pairing: PairingService) {
    this.#db = db;
    this.#clock = clock;
    this.#pairing = pairing;
  }

  /** First run: only the setup code printed at startup can create the Owner. */
  async createOwner({ code, username, password }: NewAccount): Promise<SessionAccount> {
    this.#pairing.requireSetup();
    const passwordHash = await hashPassword(password);
    const owner = this.#db.$client.transaction(() => {
      if (!this.#pairing.spend(code, 'setup')) return null;
      return this.#insert(username, passwordHash, 'owner');
    })();
    if (!owner) throw new Unauthorized(WRONG_CREDENTIALS);
    return owner;
  }

  async createMember({ code, username, password }: NewAccount): Promise<SessionAccount> {
    const passwordHash = await hashPassword(password);
    const member = this.#db.$client.transaction(() => {
      // Code first, so only a holder of a good Invite learns whether a username is taken.
      if (!this.#pairing.spend(code, 'invite')) return null;
      const taken = this.#db
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.username, username))
        .get();
      // Throwing rolls the spend back, so a taken name does not cost the Invite.
      if (taken) throw new Conflict('That username is taken');
      return this.#insert(username, passwordHash, 'member');
    })();
    if (!member) throw new Unauthorized(WRONG_CREDENTIALS);
    return member;
  }

  list(): AccountRow[] {
    return this.#db.select(accountColumns).from(accounts).orderBy(accounts.createdAt).all();
  }

  get(id: string): AccountRow {
    const row = this.#db.select(accountColumns).from(accounts).where(eq(accounts.id, id)).get();
    if (!row) throw new NotFound('No such Account');
    return row;
  }

  /** The Account's Devices stay signed in. */
  async setPassword(id: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    const updated = this.#db
      .update(accounts)
      .set({ passwordHash, updatedAt: this.#clock().toISOString() })
      .where(eq(accounts.id, id))
      .returning({ id: accounts.id })
      .get();
    if (!updated) throw new NotFound('No such Account');
  }

  find(id: string): SessionAccount | undefined {
    return this.#db.select(sessionAccountColumns).from(accounts).where(eq(accounts.id, id)).get();
  }

  findWithPassword(
    username: string
  ): (SessionAccount & { passwordHash: string | null }) | undefined {
    return this.#db
      .select({ ...sessionAccountColumns, passwordHash: accounts.passwordHash })
      .from(accounts)
      .where(eq(accounts.username, username))
      .get();
  }

  #insert(username: string, passwordHash: string, role: SessionAccount['role']): SessionAccount {
    const id = randomUUID();
    const at = this.#clock().toISOString();
    this.#db
      .insert(accounts)
      .values({ id, username, passwordHash, role, createdAt: at, updatedAt: at })
      .run();
    return { id, username, role };
  }
}
