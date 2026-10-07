import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** Node's default scrypt cost, which the stored hash does not record. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * With no stored hash (an unknown username) it still derives one key from a random salt, so a
 * wrong username costs the same as a wrong password (PLAN.md "Security"). A malformed stored hash
 * is data corruption, not a user path, and returns false without work.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined
): Promise<boolean> {
  if (stored == null) {
    await derive(password, randomBytes(16));
    return false;
  }
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
