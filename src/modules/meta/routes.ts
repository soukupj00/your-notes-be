import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HealthResponse, RootResponse } from '../../contract/index.ts';
import { hal, link } from '../../http/hal.ts';
import { VERSION } from '../../version.ts';

export const metaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/api',
    {
      schema: {
        summary: 'The entry point: links to everything a client can do',
        tags: ['meta'],
        response: { 200: RootResponse },
      },
    },
    async () =>
      hal(
        {},
        {
          self: link('/api'),
          health: link('/health'),
          docs: link('/api/docs', { title: 'API reference' }),
          openapi: link('/api/docs/json', { title: 'OpenAPI document' }),
          ...(app.services.pairing.ownerExists()
            ? {}
            : { setup: link('/api/setup', { title: 'First run' }) }),
          session: link('/api/session'),
          devices: link('/api/devices'),
          codes: link('/api/codes', { title: 'Mint a Pairing Code' }),
          accounts: link('/api/accounts', { title: 'Spend an Invite' }),
          changes: link('/api/changes', { title: 'The change feed; POST pushes a batch' }),
          stream: link('/api/changes/stream', { title: 'Live Update hints (SSE)' }),
          blobs: link('/api/blobs/{id}', { templated: true, title: 'Attachment bytes' }),
          shares: link('/api/shares', { title: 'Share Links' }),
        }
      )
  );

  app.get(
    '/health',
    {
      schema: {
        summary: 'Liveness, including a database round trip',
        tags: ['meta'],
        response: { 200: HealthResponse },
      },
    },
    async () => {
      app.services.meta.ping();
      return { status: 'ok' as const, version: VERSION };
    }
  );
};
