import { createHash, randomBytes } from 'node:crypto';

/** Every secret the server hands out has this one shape. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Secrets are stored only as their SHA-256, so a leaked database cannot sign anyone in. */
export function sha256(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
