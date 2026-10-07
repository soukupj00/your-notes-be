import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Id, Share, SharedNote, ShareRequest, SharesResponse } from '../../contract/index.ts';
import { sessionOf } from '../../http/auth.ts';
import { sendBlob } from '../../http/sendBlob.ts';
import { shareBody, sharedNoteBody, sharesBody } from './presenter.ts';

/** Per IP on the two unauthenticated routes: enough to read a Note and its pictures. */
const PUBLIC_RATE_LIMIT = { max: 60, timeWindow: '1 minute' };

const Token = z.string().min(1).max(128);

export const shareRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/api/shares',
    {
      config: { auth: true },
      schema: {
        summary: 'Share a Note read-only; sharing it again returns the same Share Link',
        tags: ['shares'],
        body: ShareRequest,
        response: { 200: Share, 201: Share },
      },
    },
    async (request, reply) => {
      const { account } = sessionOf(request);
      const { share, created } = await app.services.shares.create(account.id, request.body.noteId);
      return reply.code(created ? 201 : 200).send(shareBody(share));
    }
  );

  app.get(
    '/api/shares',
    {
      config: { auth: true },
      schema: {
        summary: "The signed-in Account's Share Links",
        tags: ['shares'],
        response: { 200: SharesResponse },
      },
    },
    async (request) => sharesBody(await app.services.shares.list(sessionOf(request).account.id))
  );

  app.get(
    '/api/shares/:id',
    {
      config: { auth: true },
      schema: {
        summary: 'One Share Link',
        tags: ['shares'],
        params: z.object({ id: Id }),
        response: { 200: Share },
      },
    },
    async (request) => {
      const { account } = sessionOf(request);
      return shareBody(await app.services.shares.get(account.id, request.params.id));
    }
  );

  app.delete(
    '/api/shares/:id',
    {
      config: { auth: true },
      schema: {
        summary: 'Revoke a Share Link; the link stops working at once',
        tags: ['shares'],
        params: z.object({ id: Id }),
      },
    },
    async (request, reply) => {
      await app.services.shares.revoke(sessionOf(request).account.id, request.params.id);
      return reply.code(204).send();
    }
  );

  app.get(
    '/api/public/shares/:token',
    {
      config: { rateLimit: PUBLIC_RATE_LIMIT },
      schema: {
        summary: 'Read a shared Note; no Session needed, only the token',
        tags: ['shares'],
        params: z.object({ token: Token }),
        response: { 200: SharedNote },
      },
    },
    async (request, reply) => {
      const { token } = request.params;
      const note = await app.services.shares.sharedNote(token);
      reply.header('cache-control', 'private, no-cache');
      return sharedNoteBody(token, note);
    }
  );

  app.route({
    method: ['GET', 'HEAD'],
    url: '/api/public/shares/:token/blobs/:id',
    config: { rateLimit: PUBLIC_RATE_LIMIT },
    schema: {
      summary: "An Attachment's bytes, only for Attachments of the shared Note",
      tags: ['shares'],
      params: z.object({ token: Token, id: Id }),
    },
    handler: async (request, reply) => {
      const { token, id } = request.params;
      return sendBlob(request, reply, await app.services.shares.sharedBlob(token, id));
    },
  });
};
