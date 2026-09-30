import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CodeRequest,
  CodeResponse,
  CreateAccountRequest,
  SessionResponse,
  SetupStatus,
} from '../../contract/index.ts';
import { sessionOf } from '../../http/auth.ts';
import { hal, link } from '../../http/hal.ts';
import { SIGN_IN_RATE_LIMIT } from '../../http/security.ts';
import { setSessionCookie } from '../../http/sessionCookie.ts';
import { sessionBody } from '../sessions/presenter.ts';

/** Pairing Codes and the first run (ADR 0001). */
export const pairingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/api/codes',
    {
      config: { auth: true },
      schema: {
        summary: 'Mint a Pairing Code; the PWA shows it as a Pairing Link and QR',
        tags: ['codes'],
        body: CodeRequest,
        response: { 201: CodeResponse },
      },
    },
    async (request, reply) => {
      const { kind } = request.body;
      const { code, expiresAt } = app.services.pairing.mintFor(sessionOf(request).account, kind);
      return reply.code(201).send({ code, kind, expiresAt });
    }
  );

  app.get(
    '/api/setup',
    {
      schema: {
        summary: 'Whether the server still needs its Owner',
        tags: ['setup'],
        response: { 200: SetupStatus },
      },
    },
    async () => {
      app.services.pairing.requireSetup();
      return hal({ needsSetup: true as const }, { self: link('/api/setup') });
    }
  );

  app.post(
    '/api/setup',
    {
      config: { rateLimit: SIGN_IN_RATE_LIMIT },
      schema: {
        summary: 'Spend the printed setup code: create the Owner and sign this Device in',
        tags: ['setup'],
        body: CreateAccountRequest,
        response: { 201: SessionResponse },
      },
    },
    async (request, reply) => {
      const { deviceName, ...account } = request.body;
      const owner = await app.services.accounts.createOwner(account);
      const { token, device } = app.services.sessions.open(owner, deviceName);
      setSessionCookie(reply, token, app.config.sessionTtlDays);
      reply.code(201);
      return sessionBody(owner, device);
    }
  );
};
