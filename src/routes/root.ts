import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
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
        }
      )
  );
};
