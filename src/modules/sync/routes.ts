import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ChangesPage, PushBatch, PushResponse } from '../../contract/index.ts';
import { sessionOf } from '../../http/auth.ts';
import { etagOf, notModified } from '../../http/etag.ts';
import { SECURITY_HEADERS } from '../../http/security.ts';
import { pageBody, pushBody } from './presenter.ts';

const PING_MS = 25_000;

export const syncRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/api/changes',
    {
      config: { auth: true },
      schema: {
        summary: 'Push a batch: one transaction, one outcome per row in input order',
        tags: ['sync'],
        body: PushBatch,
        response: { 200: PushResponse },
      },
    },
    async (request) => {
      const { account, device } = sessionOf(request);
      const { outcomes, seq } = await app.services.sync.push(account.id, device.id, request.body);
      return pushBody(outcomes, seq);
    }
  );

  app.get(
    '/api/changes',
    {
      config: { auth: true },
      schema: {
        summary: 'One page of the change feed after a Sequence; follow `next` until it is absent',
        tags: ['sync'],
        querystring: z.object({
          since: z.coerce.number().int().min(0).default(0),
          /** Where the pull began; `next` links carry it, so a paged resync is judged by it. */
          from: z.coerce.number().int().min(0).optional(),
        }),
        response: {
          200: ChangesPage,
          304: z.undefined().describe('Not modified: the ETag matched'),
        },
      },
    },
    async (request, reply) => {
      const { since, from } = request.query;
      const page = await app.services.sync.page(sessionOf(request).account.id, since, from);
      const body = pageBody(page, since, from);
      const etag = etagOf(body);
      reply.header('etag', etag).header('cache-control', 'private, no-cache');
      if (notModified(request, etag)) return reply.code(304).send(undefined);
      return body;
    }
  );

  /** Live Update: an SSE hint carrying only the Account's Sequence; the Device pulls on it. */
  app.get(
    '/api/changes/stream',
    {
      config: { auth: true },
      schema: {
        summary: 'Server-sent events: `id` is the Sequence after each accepted push, no payload',
        tags: ['sync'],
      },
    },
    async (request, reply) => {
      const { account, device } = sessionOf(request);
      const lastEventId = Number(request.headers['last-event-id']);

      // Hijacked, so the `onSend` hook never runs; its headers are written here.
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        ...SECURITY_HEADERS,
        'x-request-id': request.id,
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'x-accel-buffering': 'no',
      });
      let sent = -1;
      const send = (seq: number) => {
        if (seq <= sent || raw.writableEnded) return;
        sent = seq;
        raw.write(`id: ${seq}\nevent: change\ndata:\n\n`);
      };

      const ping = setInterval(() => raw.write(': ping\n\n'), PING_MS);
      // Subscribed before the Sequence is read, so a push in between still sends its hint.
      const remove = app.services.sync.subscribe(account.id, device.id, {
        send,
        close: () => raw.end(),
      });
      raw.on('close', () => {
        clearInterval(ping);
        remove();
      });
      try {
        const current = await app.services.sync.seq(account.id);
        if (!Number.isInteger(lastEventId) || lastEventId < current) send(current);
      } catch (error) {
        request.log.error({ err: error }, 'could not read the Sequence for a Live Update stream');
        raw.end();
      }
    }
  );
};
