import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256 } from '../../shared/crypto.ts';
import type { Store } from '../../store/Store.ts';
import { testStore } from '../../test/helpers.ts';
import { CODE_TTL_MS, PairingService } from './service.ts';

const T0 = new Date('2026-09-28T10:00:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

let store: Store;
let now: Date;
let pairing: PairingService;
/** The service with its clock set to `when`. */
const at = (when: Date) => {
  now = when;
  return pairing;
};
const account = (id: string, username: string, role: 'owner' | 'member') =>
  store.accounts.add({ id, username, role, passwordHash: '', createdAt: '' });
beforeEach(async () => {
  store = await testStore();
  pairing = new PairingService(store, () => now);
  await account('a1', 'ann', 'member');
});
afterEach(async () => {
  await store.close();
});

describe('Pairing Codes', () => {
  it('stores only the hash and expires ten minutes after minting', async () => {
    const { code, expiresAt } = await at(T0).mint('device', 'a1');
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(later(CODE_TTL_MS).toISOString());
    expect(await store.codes.spend(sha256(code), 'device', T0.toISOString())).toEqual({
      accountId: 'a1',
    });
  });

  it('spends once', async () => {
    const { code } = await at(T0).mint('device', 'a1');
    expect(await at(T0).spend(code, 'device')).toEqual({ accountId: 'a1' });
    expect(await at(T0).spend(code, 'device')).toBeUndefined();
  });

  it('rejects an expired code, an unknown code and a code of another kind', async () => {
    const { code } = await at(T0).mint('invite', 'a1');
    expect(await at(later(CODE_TTL_MS)).spend(code, 'invite')).toBeUndefined();
    expect(await at(T0).spend('nope', 'invite')).toBeUndefined();
    const other = (await at(T0).mint('invite', 'a1')).code;
    expect(await at(T0).spend(other, 'device')).toBeUndefined();
    expect(await at(later(CODE_TTL_MS - 1)).spend(other, 'invite')).toEqual({ accountId: 'a1' });
  });

  it('keeps one setup code while there is no Owner, and none after', async () => {
    const first = await at(T0).ensureSetupCode();
    const second = await at(T0).ensureSetupCode();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    expect(await at(T0).spend(first, 'setup')).toBeUndefined();
    // A setup code does not expire by the clock, and joins no Account.
    expect(await at(later(365 * 24 * 60 * 60 * 1000)).spend(second, 'setup')).toEqual({});
    await account('o1', 'olga', 'owner');
    expect(await at(T0).ensureSetupCode()).toBeNull();
  });
});
