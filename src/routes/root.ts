import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ownerExists } from '../auth/codes.ts';
import { RootResponse } from '../contract/index.ts';
import { hal, link } from '../hal.ts';

export const rootRoutes: FastifyPluginAsyncZod = async (app) => {
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
          ...(ownerExists(app.db) ? {} : { setup: link('/api/setup', { title: 'First run' }) }),
          session: link('/api/session'),
          devices: link('/api/devices'),
          codes: link('/api/codes', { title: 'Mint a Pairing Code' }),
          accounts: link('/api/accounts', { title: 'Spend an Invite' }),
          changes: link('/api/changes', { title: 'The change feed; POST pushes a batch' }),
          stream: link('/api/changes/stream', { title: 'Live Update hints (SSE)' }),
        }
      )
  );
};
