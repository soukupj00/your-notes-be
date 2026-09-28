import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HealthResponse } from '../contract/index.ts';
import { VERSION } from '../version.ts';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
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
      app.db.$client.prepare('select 1').get();
      return { status: 'ok' as const, version: VERSION };
    }
  );
};
