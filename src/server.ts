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
import { registerAuth } from './http/auth.ts';
import { registerDocs } from './http/docs.ts';
import { registerErrorHandler } from './http/errors.ts';
import { genReqId, registerSecurity } from './http/security.ts';
import { registerStatic } from './http/static.ts';
import { accountRoutes } from './modules/accounts/routes.ts';
import { AccountService } from './modules/accounts/service.ts';
import { blobRoutes } from './modules/blobs/routes.ts';
import { BlobService } from './modules/blobs/service.ts';
import { HousekeepingService } from './modules/housekeeping/service.ts';
import { metaRoutes } from './modules/meta/routes.ts';
import { MetaService } from './modules/meta/service.ts';
import { pairingRoutes } from './modules/pairing/routes.ts';
import { PairingService } from './modules/pairing/service.ts';
import { sessionRoutes } from './modules/sessions/routes.ts';
import { SessionService } from './modules/sessions/service.ts';
import { shareRoutes } from './modules/shares/routes.ts';
import { ShareService } from './modules/shares/service.ts';
import { LiveUpdates } from './modules/sync/liveUpdates.ts';
import { syncRoutes } from './modules/sync/routes.ts';
import { SyncService } from './modules/sync/service.ts';
import type { Clock } from './shared/clock.ts';

export type Services = {
  pairing: PairingService;
  accounts: AccountService;
  sessions: SessionService;
  sync: SyncService;
  blobs: BlobService;
  shares: ShareService;
  housekeeping: HousekeepingService;
  meta: MetaService;
};

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    /** For the API tests, which look at stored bytes; routes go through `services.blobs`. */
    blobs: BlobStore;
    services: Services;
  }
}

export type ServerDeps = {
  config: Config;
  db: Db;
  blobs: BlobStore;
  logger?: FastifyServerOptions['logger'];
  /** The clock every expiry is measured against; tests pass their own. */
  now?: Clock;
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

  // Every service is built here, once, and reached by routes through `app.services` (ADR 0007).
  const live = new LiveUpdates();
  const pairing = new PairingService(db, now);
  const accounts = new AccountService(db, now, pairing);
  const blobService = new BlobService(db, blobs, now);
  const services: Services = {
    pairing,
    accounts,
    sessions: new SessionService(db, now, accounts, pairing, config.sessionTtlDays),
    sync: new SyncService(db, now, live, config.pageSize),
    blobs: blobService,
    shares: new ShareService(db, now, blobService),
    housekeeping: new HousekeepingService(db, blobs, config.tombstoneDays),
    meta: new MetaService(db),
  };
  app.decorate('config', config);
  app.decorate('blobs', blobs);
  app.decorate('services', services);
  // Open streams would otherwise hold `close()` until their clients leave.
  app.addHook('preClose', async () => live.closeAll());

  registerErrorHandler(app);
  registerSecurity(app);

  await app.register(sensible);
  await app.register(cookie);
  registerAuth(app);
  // Routes opt in through `config.rateLimit`: sign-in, code redemption, public Share Links.
  await app.register(rateLimit, { global: false });
  await registerDocs(app);

  await app.register(metaRoutes);
  await app.register(pairingRoutes);
  await app.register(sessionRoutes);
  await app.register(accountRoutes);
  await app.register(syncRoutes);
  await app.register(blobRoutes);
  await app.register(shareRoutes);
  await registerStatic(app, config.publicDir);

  return app;
}

export type App = Awaited<ReturnType<typeof buildServer>>;
