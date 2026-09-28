import type { Readable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertBlobId, BlobSizeMismatchError } from '../blobs/BlobStore.ts';
import { Id } from '../contract/index.ts';
import { blobs } from '../db/schema.ts';
import { sessionOf } from '../plugins/auth.ts';
import { sendProblem } from '../problem.ts';

const Params = z.object({ id: Id });

/**
 * Attachment bytes, write-once by id (frontend ADR 0017). Encapsulated so the raw-stream body
 * parser below applies to these routes only; every other route keeps parsing JSON.
 */
export const blobRoutes: FastifyPluginAsyncZod = async (app) => {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

  app.put(
    '/api/blobs/:id',
    {
      config: { auth: true },
      schema: {
        summary: "Upload an Attachment's bytes; a repeat is 204 without reading the body",
        tags: ['blobs'],
        params: Params,
      },
    },
    async (request, reply) => {
      const { account } = sessionOf(request);
      const { id } = request.params;
      assertBlobId(id);
      const lengthHeader = request.headers['content-length'];
      const mime = request.headers['content-type'];
      const size = Number(lengthHeader);
      // Early answers never read the body: a refused large one closes the connection,
      // a small one is drained so the connection can be reused.
      if (lengthHeader === undefined) {
        reply.header('connection', 'close');
        return sendProblem(reply, 411, 'Send Content-Length');
      }
      if (size > app.config.blobLimitBytes) {
        reply.header('connection', 'close');
        return sendProblem(reply, 413, `A blob is at most ${app.config.blobLimitBytes} bytes`);
      }
      if (!mime || mime.length > 255) {
        request.raw.resume();
        return sendProblem(reply, 400, 'Send the Content-Type of the bytes');
      }
      const row = app.db.select().from(blobs).where(eq(blobs.id, id)).get();
      if (row && row.accountId !== account.id) {
        request.raw.resume();
        return sendProblem(reply, 403, 'This id belongs to someone else');
      }
      // A row whose file is missing takes the upload again, so a lost file can be healed.
      if (row && (await app.blobs.has(id))) {
        request.raw.resume();
        return reply.code(204).send();
      }
      try {
        // Node's HTTP parser stops the body at Content-Length, so it cannot exceed the limit.
        await app.blobs.put(id, request.body as Readable, size);
      } catch (error) {
        if (error instanceof BlobSizeMismatchError) return sendProblem(reply, 400, error.message);
        throw error;
      }
      // File first, row second: a crash between them leaves a file the sweep removes.
      app.db
        .insert(blobs)
        .values({ id, accountId: account.id, size, mime, createdAt: app.now().toISOString() })
        .onConflictDoNothing()
        .run();
      return reply.code(201).header('location', `/api/blobs/${id}`).send();
    }
  );

  app.route({
    method: ['GET', 'HEAD'],
    url: '/api/blobs/:id',
    config: { auth: true },
    schema: {
      summary: "Download an Attachment's bytes; HEAD answers whether the server has them",
      tags: ['blobs'],
      params: Params,
    },
    handler: async (request, reply) => {
      const { account } = sessionOf(request);
      const { id } = request.params;
      const row = app.db
        .select()
        .from(blobs)
        .where(and(eq(blobs.id, id), eq(blobs.accountId, account.id)))
        .get();
      // Another Account's id is as unknown as one that does not exist.
      if (!row) return sendProblem(reply, 404, 'No such blob');
      const etag = `"${id}"`;
      reply.headers({
        etag,
        'cache-control': 'private, max-age=31536000, immutable',
        // Uploaded bytes never run as a page of this origin, whatever their Content-Type says.
        'content-security-policy': "default-src 'none'; sandbox",
      });
      if (request.headers['if-none-match']?.split(',').some((tag) => tag.trim() === etag)) {
        return reply.code(304).send();
      }
      reply.headers({ 'content-type': row.mime, 'content-length': row.size });
      if (request.method === 'HEAD') return reply.send();
      const bytes = await app.blobs.get(id);
      if (!bytes) {
        request.log.error({ blobId: id }, 'blob row without a file');
        return sendProblem(reply, 500);
      }
      return reply.send(bytes);
    },
  });
};
