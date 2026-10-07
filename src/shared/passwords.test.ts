import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.ts';

describe('passwords', () => {
  it('records the scrypt parameters with the salt and the key', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash.split('$')).toHaveLength(6);
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{88}$/);
  });

  it('round-trips and salts every hash', async () => {
    const hash = await hashPassword('correct horse');
    expect(await hashPassword('correct horse')).not.toBe(hash);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    expect(await verifyPassword('wrong horse', await hashPassword('correct horse'))).toBe(false);
  });

  it('verifies a hash written before the parameters were stored', async () => {
    const legacy =
      'scrypt$+3XjO10vG6hDM+ZCILrKFg==$tpbW3ZdFdfXlvlNkBbianzDo/MUV0dZAFrqNqAFUu//sxYz051JMwb54iGzjyTJur3s0nSqCzY2IOhXjVP4tkQ==';
    expect(await verifyPassword('correct horse', legacy)).toBe(true);
    expect(await verifyPassword('wrong horse', legacy)).toBe(false);
  });

  it('verifies with the parameters the hash names', async () => {
    const salt = randomBytes(16);
    const key = scryptSync('correct horse', salt, 64, { N: 1024, r: 8, p: 1 });
    const hash = `scrypt$1024$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
    expect(await verifyPassword('correct horse', hash)).toBe(true);
  });

  it('says false without a stored hash, after doing the same work', async () => {
    expect(await verifyPassword('anything at all', null)).toBe(false);
    expect(await verifyPassword('anything at all', undefined)).toBe(false);
  });

  it('rejects a malformed stored hash', async () => {
    for (const stored of [
      'bcrypt$x$y',
      'scrypt$abc$def',
      'scrypt$16384$8$1$abc',
      'scrypt$3$8$1$abc$def',
      'scrypt$x$8$1$abc$def',
    ]) {
      expect(await verifyPassword('correct horse', stored)).toBe(false);
    }
  });
});
