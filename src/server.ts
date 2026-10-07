import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.ts';
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
import type { BlobStore } from './store/BlobStore.ts';
import type { Store } from './store/Store.ts';

export type Services = {
  pairing: PairingService;
  accounts: AccountService;
  sessions: SessionService;
  sync: SyncService;
  blobs: BlobService;
  shares: ShareService;
  housekeeping: HousekeepingService;
};

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    services: Services;
  }
}

export type ServerDeps = {
  config: Config;
  store: Store;
  blobs: BlobStore;
  /** Must carry `LOG_SERIALIZERS`, which mask Share Link tokens. */
  logger: FastifyBaseLogger | false;
  now?: Clock;
};

/** The whole application, ready for `inject()` or `listen()`; it never listens itself. */
export async function buildServer({
  config,
  store,
  blobs,
  logger,
  now = () => new Date(),
}: ServerDeps) {
  const app = Fastify({
    ...(logger ? { loggerInstance: logger } : { logger: false }),
    bodyLimit: config.bodyLimitBytes,
    trustProxy: config.trustProxy,
    genReqId,
    requestIdHeader: false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const live = new LiveUpdates();
  const pairing = new PairingService(store, now);
  const accounts = new AccountService(store, now, pairing);
  const blobService = new BlobService(store, blobs, now);
  const services: Services = {
    pairing,
    accounts,
    sessions: new SessionService(store, now, accounts, pairing, config.sessionTtlDays),
    sync: new SyncService(store, now, live, config.pageSize),
    blobs: blobService,
    shares: new ShareService(store, now, blobService),
    housekeeping: new HousekeepingService(store, blobs, config.tombstoneDays),
  };
  app.decorate('config', config);
  app.decorate('services', services);
  // Open streams would otherwise hold `close()` until their clients leave.
  app.addHook('preClose', async () => live.closeAll());

  registerErrorHandler(app);
  registerSecurity(app);

  await app.register(sensible);
  await app.register(cookie);
  registerAuth(app);
  // Routes opt in through `config.rateLimit`.
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
