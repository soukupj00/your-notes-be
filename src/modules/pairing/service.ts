import type { Clock } from '../../shared/clock.ts';
import { newSecret, sha256 } from '../../shared/crypto.ts';
import { Forbidden, NotFound } from '../../shared/errors.ts';
import type { AccountRecord, CodeKind, SpentCode } from '../../store/records.ts';
import type { Store, StoreTx } from '../../store/Store.ts';

export const CODE_TTL_MS = 10 * 60 * 1000;

/** A `setup` code does not expire by the clock; it dies when used or when the server restarts. */
const NEVER = '9999-12-31T23:59:59.999Z';

const ALREADY_SET_UP = 'This server already has an Owner';

/** Pairing Codes (ADR 0001), and whether the server still waits for its Owner. */
export class PairingService {
  readonly #store: Store;
  readonly #clock: Clock;

  constructor(store: Store, clock: Clock) {
    this.#store = store;
    this.#clock = clock;
  }

  /** `accountId` is absent only for `setup`. */
  async mint(kind: CodeKind, accountId?: string): Promise<{ code: string; expiresAt: string }> {
    const now = this.#clock();
    const code = newSecret();
    const expiresAt =
      kind === 'setup' ? NEVER : new Date(now.getTime() + CODE_TTL_MS).toISOString();
    await this.#store.codes.add({
      codeHash: sha256(code),
      kind,
      accountId,
      createdAt: now.toISOString(),
      expiresAt,
    });
    return { code, expiresAt };
  }

  async mintFor(
    account: Pick<AccountRecord, 'id' | 'role'>,
    kind: 'device' | 'invite'
  ): Promise<{ code: string; expiresAt: string }> {
    if (kind === 'invite' && account.role !== 'owner') {
      throw new Forbidden('Only the Owner can invite');
    }
    return this.mint(kind, account.id);
  }

  /** A code of another kind is left unspent, so a device code never passes as an Invite. */
  spend(
    code: string,
    kind: CodeKind,
    store: StoreTx = this.#store
  ): Promise<SpentCode | undefined> {
    return store.codes.spend(sha256(code), kind, this.#clock().toISOString());
  }

  async ownerExists(): Promise<boolean> {
    return (await this.#store.accounts.owner()) !== undefined;
  }

  async requireSetup(): Promise<void> {
    if (await this.ownerExists()) throw new NotFound(ALREADY_SET_UP);
  }

  /** Replaces any earlier setup code, so only the link printed last works. */
  async ensureSetupCode(): Promise<string | null> {
    if (await this.ownerExists()) return null;
    await this.#store.codes.removeSetupCodes();
    return (await this.mint('setup')).code;
  }
}
