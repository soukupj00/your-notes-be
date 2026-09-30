import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/client.ts';
import { openDatabase } from '../db/client.ts';
import { migrateDatabase } from '../db/migrate.ts';
import { accounts, codes } from '../db/schema.ts';
import { sha256 } from '../shared/crypto.ts';
import { CODE_TTL_MS, ensureSetupCode, mintCode, spendCode } from './codes.ts';

const T0 = new Date('2026-09-28T10:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

let db: Db;
beforeEach(() => {
  db = openDatabase(':memory:');
  migrateDatabase(db);
  db.insert(accounts)
    .values({ id: 'a1', username: 'ann', role: 'member', createdAt: '', updatedAt: '' })
    .run();
});

describe('Pairing Codes', () => {
  it('stores only the hash and expires ten minutes after minting', () => {
    const { code, expiresAt } = mintCode(db, 'device', 'a1', T0);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(later(CODE_TTL_MS).toISOString());
    expect(db.select().from(codes).all()).toEqual([
      expect.objectContaining({ codeHash: sha256(code), kind: 'device', accountId: 'a1' }),
    ]);
  });

  it('spends once', () => {
    const { code } = mintCode(db, 'device', 'a1', T0);
    expect(spendCode(db, code, 'device', T0)).toEqual({ accountId: 'a1' });
    expect(spendCode(db, code, 'device', T0)).toBeNull();
  });

  it('rejects an expired code, an unknown code and a code of another kind', () => {
    const { code } = mintCode(db, 'invite', 'a1', T0);
    expect(spendCode(db, code, 'invite', later(CODE_TTL_MS))).toBeNull();
    expect(spendCode(db, 'nope', 'invite', T0)).toBeNull();
    const other = mintCode(db, 'invite', 'a1', T0).code;
    expect(spendCode(db, other, 'device', T0)).toBeNull();
    expect(spendCode(db, other, 'invite', later(CODE_TTL_MS - 1))).toEqual({ accountId: 'a1' });
  });

  it('keeps one setup code while there is no Owner, and none after', () => {
    const first = ensureSetupCode(db, T0);
    const second = ensureSetupCode(db, T0);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    expect(spendCode(db, first, 'setup', T0)).toBeNull();
    // A setup code does not expire by the clock.
    expect(spendCode(db, second, 'setup', later(365 * 24 * 60 * 60 * 1000))).toEqual({
      accountId: null,
    });
    db.insert(accounts)
      .values({ id: 'o1', username: 'olga', role: 'owner', createdAt: '', updatedAt: '' })
      .run();
    expect(ensureSetupCode(db, T0)).toBeNull();
  });
});
