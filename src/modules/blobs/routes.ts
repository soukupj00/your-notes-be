import type { Readable } from 'node:stream';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Id } from '../../contract/index.ts';
import { sessionOf } from '../../http/auth.ts';
import { sendProblem } from '../../http/errors.ts';
import { sendBlob } from '../../http/sendBlob.ts';

const Params = z.object({ id: Id });

/**
 * Encapsulated so the raw-stream body parser applies to these routes only; every other route
 * keeps parsing JSON.
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
      const state = await app.services.blobs.uploadState(account.id, id);
      if (state === 'foreign') {
        request.raw.resume();
        return sendProblem(reply, 403, 'This id belongs to someone else');
      }
      if (state === 'stored') {
        request.raw.resume();
        return reply.code(204).send();
      }
      // Node's HTTP parser stops the body at Content-Length, so it cannot exceed the limit.
      await app.services.blobs.upload(account.id, id, request.body as Readable, size, mime);
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
      const row = app.services.blobs.mine(sessionOf(request).account.id, request.params.id);
      return sendBlob(request, reply, row);
    },
  });
};
