import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

type Cost = { N: number; r: number; p: number };

const KEY_LENGTH = 64;
const COST: Cost = { N: 16384, r: 8, p: 1 };
// Hashes written before the parameters were stored; Node's defaults at the time, fixed here forever.
const LEGACY_COST: Cost = { N: 16384, r: 8, p: 1 };

function derive(password: string, salt: Buffer, { N, r, p }: Cost): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: 128 * N * r * 2 }, (error, key) =>
      error ? reject(error) : resolve(key)
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  const { N, r, p } = COST;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function parse(stored: string): { cost: Cost; salt: string; key: string } | undefined {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return undefined;
  if (parts.length === 3) {
    const [, salt = '', key = ''] = parts;
    return { cost: LEGACY_COST, salt, key };
  }
  if (parts.length === 6) {
    const [, N, r, p, salt = '', key = ''] = parts;
    return { cost: { N: Number(N), r: Number(r), p: Number(p) }, salt, key };
  }
  return undefined;
}

/**
 * With no stored hash (an unknown username) it still derives one key from a random salt, so a
 * wrong username costs the same as a wrong password (PLAN.md "Security"). A malformed stored hash
 * is data corruption, not a user path, and returns false; scrypt itself refuses bad parameters.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined
): Promise<boolean> {
  if (stored == null) {
    await derive(password, randomBytes(16), COST);
    return false;
  }
  const hash = parse(stored);
  if (!hash) return false;
  const expected = Buffer.from(hash.key, 'base64');
  const actual = await derive(password, Buffer.from(hash.salt, 'base64'), hash.cost).catch(
    () => undefined
  );
  return actual?.length === expected.length && timingSafeEqual(actual, expected);
}
