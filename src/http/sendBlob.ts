import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BlobRecord } from '../store/records.ts';
import { sendProblem } from './errors.ts';
import { notModified } from './etag.ts';

/** Fetch Metadata: absent from curl, and from browsers older than the app supports (Safari 16.4, Firefox 90). */
const SERVED_DESTINATIONS = new Set([undefined, 'empty', 'document', 'image', 'audio', 'video']);

/** Bytes are write-once by id, so the id is the ETag and a copy may be kept for a year. */
export async function sendBlob(
  request: FastifyRequest,
  reply: FastifyReply,
  blob: BlobRecord
): Promise<FastifyReply> {
  // The PWA's `script-src 'self'` admits any same-origin URL, and an upload's type is the uploader's word.
  if (!SERVED_DESTINATIONS.has(request.headers['sec-fetch-dest'])) {
    return sendProblem(reply, 403, 'Uploaded bytes never load as a script, worker or stylesheet');
  }
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
    // Else a copy cached for a `fetch` would load as a script without asking the server.
    vary: 'Sec-Fetch-Dest',
    // Uploaded bytes never run as a page of this origin, whatever their Content-Type says.
    'content-security-policy': "default-src 'none'; sandbox",
  });
  if (fresh) return reply.code(304).send();
  reply.headers({ 'content-type': blob.mime, 'content-length': blob.size });
  return reply.send(bodyless ? undefined : bytes);
}
