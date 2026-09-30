import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { accounts, codes } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { newSecret, sha256 } from '../../shared/crypto.ts';
import { Forbidden, NotFound } from '../../shared/errors.ts';
import type { SessionAccount } from '../sessions/service.ts';

export type CodeKind = 'setup' | 'device' | 'invite';

export const CODE_TTL_MS = 10 * 60 * 1000;

/** A `setup` code does not expire by the clock; it dies when used or when the server restarts. */
const NEVER = '9999-12-31T23:59:59.999Z';

const ALREADY_SET_UP = 'This server already has an Owner';

/** Pairing Codes (ADR 0001), and whether the server still waits for its Owner. */
export class PairingService {
  readonly #db: Db;
  readonly #clock: Clock;

  constructor(db: Db, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  mint(kind: CodeKind, accountId: string | null): { code: string; expiresAt: string } {
    const now = this.#clock();
    const code = newSecret();
    const expiresAt =
      kind === 'setup' ? NEVER : new Date(now.getTime() + CODE_TTL_MS).toISOString();
    this.#db
      .insert(codes)
      .values({ codeHash: sha256(code), kind, accountId, createdAt: now.toISOString(), expiresAt })
      .run();
    return { code, expiresAt };
  }

  /** `device` adds a Device to this Account, `invite` a member, which only the Owner may do. */
  mintFor(account: SessionAccount, kind: 'device' | 'invite'): { code: string; expiresAt: string } {
    if (kind === 'invite' && account.role !== 'owner') {
      throw new Forbidden('Only the Owner can invite');
    }
    return this.mint(kind, account.id);
  }

  /** A code of another kind is left unspent, so a device code never passes as an Invite. */
  spend(code: string, kind: CodeKind): { accountId: string | null } | null {
    const at = this.#clock().toISOString();
    const spent = this.#db
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

  ownerExists(): boolean {
    const owner = this.#db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.role, 'owner'))
      .get();
    return owner !== undefined;
  }

  /** Setup exists only until the Owner does (ADR 0001). */
  requireSetup(): void {
    if (this.ownerExists()) throw new NotFound(ALREADY_SET_UP);
  }

  /** At startup, while there is no Owner, a new setup code replaces any earlier one (ADR 0001). */
  ensureSetupCode(): string | null {
    if (this.ownerExists()) return null;
    this.#db.delete(codes).where(eq(codes.kind, 'setup')).run();
    return this.mint('setup', null).code;
  }
}
