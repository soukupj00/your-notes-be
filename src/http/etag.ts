import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export function etagOf(body: unknown): string {
  return `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`;
}

/** Weak comparison, as RFC 9110 13.1.2 requires for If-None-Match; a proxy may weaken our tag. */
export function notModified(request: FastifyRequest, etag: string): boolean {
  const header = request.headers['if-none-match'];
  if (header === undefined) return false;
  const tags = header.split(',').map((tag) => tag.trim().replace(/^W\//, ''));
  return tags.includes('*') || tags.includes(etag);
}
