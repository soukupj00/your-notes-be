import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BlobRow } from '../modules/blobs/service.ts';
import { sendProblem } from './errors.ts';
import { notModified } from './etag.ts';

/** Bytes are write-once by id, so the id is the ETag and a copy may be kept for a year. */
export async function sendBlob(
  request: FastifyRequest,
  reply: FastifyReply,
  row: BlobRow
): Promise<FastifyReply> {
  const etag = `"${row.id}"`;
  reply.headers({
    etag,
    'cache-control': 'private, max-age=31536000, immutable',
    // Uploaded bytes never run as a page of this origin, whatever their Content-Type says.
    'content-security-policy': "default-src 'none'; sandbox",
  });
  if (notModified(request, etag)) return reply.code(304).send();
  reply.headers({ 'content-type': row.mime, 'content-length': row.size });
  if (request.method === 'HEAD') return reply.send();
  const bytes = await request.server.services.blobs.bytes(row.id);
  if (!bytes) {
    request.log.error({ blobId: row.id }, 'blob row without a file');
    return sendProblem(reply, 500);
  }
  return reply.send(bytes);
}
