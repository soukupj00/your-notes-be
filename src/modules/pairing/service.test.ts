import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../db/client.ts';
import { openDatabase } from '../../db/client.ts';
import { migrateDatabase } from '../../db/migrate.ts';
import { accounts, codes } from '../../db/schema.ts';
import { sha256 } from '../../shared/crypto.ts';
import { CODE_TTL_MS, PairingService } from './service.ts';

const T0 = new Date('2026-09-28T10:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

let db: Db;
let now: Date;
let pairing: PairingService;
/** The service with its clock set to `when`. */
const at = (when: Date) => {
  now = when;
  return pairing;
};
beforeEach(() => {
  db = openDatabase(':memory:');
  pairing = new PairingService(db, () => now);
  migrateDatabase(db);
  db.insert(accounts)
    .values({ id: 'a1', username: 'ann', role: 'member', createdAt: '', updatedAt: '' })
    .run();
});

describe('Pairing Codes', () => {
  it('stores only the hash and expires ten minutes after minting', () => {
    const { code, expiresAt } = at(T0).mint('device', 'a1');
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(later(CODE_TTL_MS).toISOString());
    expect(db.select().from(codes).all()).toEqual([
      expect.objectContaining({ codeHash: sha256(code), kind: 'device', accountId: 'a1' }),
    ]);
  });

  it('spends once', () => {
    const { code } = at(T0).mint('device', 'a1');
    expect(at(T0).spend(code, 'device')).toEqual({ accountId: 'a1' });
    expect(at(T0).spend(code, 'device')).toBeNull();
  });

  it('rejects an expired code, an unknown code and a code of another kind', () => {
    const { code } = at(T0).mint('invite', 'a1');
    expect(at(later(CODE_TTL_MS)).spend(code, 'invite')).toBeNull();
    expect(at(T0).spend('nope', 'invite')).toBeNull();
    const other = at(T0).mint('invite', 'a1').code;
    expect(at(T0).spend(other, 'device')).toBeNull();
    expect(at(later(CODE_TTL_MS - 1)).spend(other, 'invite')).toEqual({ accountId: 'a1' });
  });

  it('keeps one setup code while there is no Owner, and none after', () => {
    const first = at(T0).ensureSetupCode();
    const second = at(T0).ensureSetupCode();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    expect(at(T0).spend(first, 'setup')).toBeNull();
    // A setup code does not expire by the clock.
    expect(at(later(365 * 24 * 60 * 60 * 1000)).spend(second, 'setup')).toEqual({
      accountId: null,
    });
    db.insert(accounts)
      .values({ id: 'o1', username: 'olga', role: 'owner', createdAt: '', updatedAt: '' })
      .run();
    expect(at(T0).ensureSetupCode()).toBeNull();
  });
});
