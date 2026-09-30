import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export function etagOf(body: unknown): string {
  return `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`;
}

/** Whether the request's `If-None-Match` lists this ETag, so a 304 answers it. */
export function notModified(request: FastifyRequest, etag: string): boolean {
  return request.headers['if-none-match']?.split(',').some((tag) => tag.trim() === etag) ?? false;
}
