import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { BlobStore } from './blobs/BlobStore.ts';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { registerAuth } from './plugins/auth.ts';
import { registerDocs } from './plugins/docs.ts';
import { genReqId, registerSecurity } from './plugins/security.ts';
import { registerStatic } from './plugins/static.ts';
import { registerErrorHandler } from './problem.ts';
import { healthRoutes } from './routes/health.ts';
import { rootRoutes } from './routes/root.ts';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    blobs: BlobStore;
  }
}

export type ServerDeps = {
  config: Config;
  db: Db;
  blobs: BlobStore;
  logger?: FastifyServerOptions['logger'];
};

/** The whole application, ready for `inject()` or `listen()`; it never listens itself. */
export async function buildServer({ config, db, blobs, logger }: ServerDeps) {
  const app = Fastify({
    logger: logger ?? { level: config.logLevel },
    bodyLimit: config.bodyLimitBytes,
    trustProxy: config.trustProxy,
    genReqId,
    requestIdHeader: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('blobs', blobs);

  registerErrorHandler(app);
  registerSecurity(app);
  registerAuth(app);

  await app.register(sensible);
  await app.register(cookie);
  // Limits are opted into per route (sign-in, code redemption), not applied globally.
  await app.register(rateLimit, { global: false });
  await registerDocs(app);

  await app.register(rootRoutes);
  await app.register(healthRoutes);
  await registerStatic(app, config.publicDir);

  return app;
}

export type App = Awaited<ReturnType<typeof buildServer>>;
