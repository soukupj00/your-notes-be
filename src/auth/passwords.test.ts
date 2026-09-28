import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.ts';

describe('passwords', () => {
  it('round-trips and salts every hash', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]{88}$/);
    expect(await hashPassword('correct horse')).not.toBe(hash);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    expect(await verifyPassword('wrong horse', await hashPassword('correct horse'))).toBe(false);
  });

  it('says false without a stored hash, after doing the same work', async () => {
    expect(await verifyPassword('anything at all', null)).toBe(false);
    expect(await verifyPassword('anything at all', undefined)).toBe(false);
  });

  it('rejects a malformed stored hash', async () => {
    expect(await verifyPassword('correct horse', 'bcrypt$x$y')).toBe(false);
  });
});
