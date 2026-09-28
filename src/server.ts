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
import { accountRoutes } from './routes/accounts.ts';
import { codeRoutes } from './routes/codes.ts';
import { deviceRoutes } from './routes/devices.ts';
import { healthRoutes } from './routes/health.ts';
import { rootRoutes } from './routes/root.ts';
import { sessionRoutes } from './routes/session.ts';
import { setupRoutes } from './routes/setup.ts';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    blobs: BlobStore;
    /** The clock every expiry is measured against; tests pass their own. */
    now: () => Date;
  }
}

export type ServerDeps = {
  config: Config;
  db: Db;
  blobs: BlobStore;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
};

/** The whole application, ready for `inject()` or `listen()`; it never listens itself. */
export async function buildServer({
  config,
  db,
  blobs,
  logger,
  now = () => new Date(),
}: ServerDeps) {
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
  app.decorate('now', now);

  registerErrorHandler(app);
  registerSecurity(app);

  await app.register(sensible);
  await app.register(cookie);
  registerAuth(app);
  // Limits are opted into per route (sign-in, code redemption), not applied globally.
  await app.register(rateLimit, { global: false });
  await registerDocs(app);

  await app.register(rootRoutes);
  await app.register(healthRoutes);
  await app.register(setupRoutes);
  await app.register(sessionRoutes);
  await app.register(deviceRoutes);
  await app.register(codeRoutes);
  await app.register(accountRoutes);
  await registerStatic(app, config.publicDir);

  return app;
}

export type App = Awaited<ReturnType<typeof buildServer>>;
