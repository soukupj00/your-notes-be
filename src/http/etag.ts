import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export function etagOf(body: unknown): string {
  return `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`;
}

/** Exact match only, simpler than RFC 9110 13.1.2: a `W/` or `*` tag gets a 200, never a 304. */
export function notModified(request: FastifyRequest, etag: string): boolean {
  return request.headers['if-none-match']?.split(',').some((tag) => tag.trim() === etag) ?? false;
}
