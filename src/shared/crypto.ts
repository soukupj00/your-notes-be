import { createHash, randomBytes } from 'node:crypto';

/** The one shape of every secret the server hands out: 32 random bytes, base64url. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Secrets are stored only as their SHA-256, so a leaked database cannot sign anyone in. */
export function sha256(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
