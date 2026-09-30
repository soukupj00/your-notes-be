import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accounts } from '../db/schema.ts';
import { sessionOf } from '../plugins/auth.ts';
import { SECURITY_HEADERS } from '../plugins/security.ts';

const PING_MS = 25_000;

/** Live Update: an SSE hint carrying only the Account's Sequence; the Device answers it with a pull. */
export const streamRoutes: FastifyPluginAsyncZod = async (app) => {
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
      const current =
        app.db.select({ seq: accounts.seq }).from(accounts).where(eq(accounts.id, account.id)).get()
          ?.seq ?? 0;
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
      const send = (seq: number) => raw.write(`id: ${seq}\nevent: change\ndata:\n\n`);
      if (!Number.isInteger(lastEventId) || lastEventId < current) send(current);

      const ping = setInterval(() => raw.write(': ping\n\n'), PING_MS);
      const remove = app.live.add(account.id, device.id, { send, close: () => raw.end() });
      raw.on('close', () => {
        clearInterval(ping);
        remove();
      });
    }
  );
};
