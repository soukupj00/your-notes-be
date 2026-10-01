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
  const etag = `"${blob.id}"`;
  reply.headers({
    etag,
    'cache-control': 'private, max-age=31536000, immutable',
    // Uploaded bytes never run as a page of this origin, whatever their Content-Type says.
    'content-security-policy': "default-src 'none'; sandbox",
  });
  if (notModified(request, etag)) return reply.code(304).send();
  reply.headers({ 'content-type': blob.mime, 'content-length': blob.size });
  if (request.method === 'HEAD') return reply.send();
  const bytes = await request.server.services.blobs.bytes(blob.id);
  if (!bytes) {
    request.log.error({ blobId: blob.id }, 'blob record without a file');
    return sendProblem(reply, 500);
  }
  return reply.send(bytes);
}
