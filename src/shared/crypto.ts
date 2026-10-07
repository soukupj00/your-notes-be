import { createHash, randomBytes } from 'node:crypto';

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this hash of a Session or Pairing Code is stored, so a leaked database signs no one in. */
export function sha256(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
