import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BlobRecord } from '../store/records.ts';
import { sendProblem } from './errors.ts';
import { notModified } from './etag.ts';

/** Bytes are write-once by id, so the id is the ETag and a copy may be kept for a year. */
export async function sendBlob(
  request: FastifyRequest,
  reply: FastifyReply,
  blob: BlobRecord
): Promise<FastifyReply> {
  const { blobs } = request.server.services;
  const etag = `"${blob.id}"`;
  const fresh = notModified(request, etag);
  const bodyless = fresh || request.method === 'HEAD';
  const bytes = bodyless ? await blobs.has(blob.id) : await blobs.bytes(blob.id);
  // Before any caching header, so the 404 is never kept and the next PUT can heal it.
  if (!bytes) {
    request.log.error({ blobId: blob.id }, 'blob record without a file');
    return sendProblem(reply, 404, 'No such blob');
  }
  reply.headers({
    etag,
    'cache-control': 'private, max-age=31536000, immutable',
    // Uploaded bytes never run as a page of this origin, whatever their Content-Type says.
    'content-security-policy': "default-src 'none'; sandbox",
  });
  if (fresh) return reply.code(304).send();
  reply.headers({ 'content-type': blob.mime, 'content-length': blob.size });
  return reply.send(bodyless ? undefined : bytes);
}
