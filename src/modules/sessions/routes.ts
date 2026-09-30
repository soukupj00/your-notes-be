import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DevicesResponse, Id, SessionResponse, SignInRequest } from '../../contract/index.ts';
import { sessionOf } from '../../http/auth.ts';
import { SIGN_IN_RATE_LIMIT } from '../../http/security.ts';
import { clearSessionCookie, setSessionCookie } from '../../http/sessionCookie.ts';
import { devicesBody, sessionBody } from './presenter.ts';

export const sessionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/api/session',
    {
      config: { rateLimit: SIGN_IN_RATE_LIMIT },
      schema: {
        summary: 'Sign this Device in with a password or a device Pairing Code',
        tags: ['session'],
        body: SignInRequest,
        response: { 201: SessionResponse },
      },
    },
    async (request, reply) => {
      const { token, account, device } = await app.services.sessions.signIn(request.body);
      setSessionCookie(reply, token, app.config.sessionTtlDays);
      reply.code(201);
      return sessionBody(account, device);
    }
  );

  app.get(
    '/api/session',
    {
      config: { auth: true },
      schema: {
        summary: 'Who this Device is signed in as',
        tags: ['session'],
        response: { 200: SessionResponse },
      },
    },
    async (request) => {
      const { account, device } = sessionOf(request);
      return sessionBody(account, device);
    }
  );

  app.delete(
    '/api/session',
    {
      config: { auth: true },
      schema: { summary: 'Sign this Device out', tags: ['session'] },
    },
    async (request, reply) => {
      app.services.sessions.end(sessionOf(request).device.id);
      clearSessionCookie(reply);
      return reply.code(204).send();
    }
  );

  app.get(
    '/api/devices',
    {
      config: { auth: true },
      schema: {
        summary: "The signed-in Account's Devices",
        tags: ['devices'],
        response: { 200: DevicesResponse },
      },
    },
    async (request) => {
      const { account, device } = sessionOf(request);
      return devicesBody(app.services.sessions.devices(account.id), device.id);
    }
  );

  app.delete(
    '/api/devices/:id',
    {
      config: { auth: true },
      schema: {
        summary: 'Revoke a Device: end its Session',
        tags: ['devices'],
        params: z.object({ id: Id }),
      },
    },
    async (request, reply) => {
      const { account, device } = sessionOf(request);
      app.services.sessions.revoke(account.id, request.params.id);
      if (request.params.id === device.id) clearSessionCookie(reply);
      return reply.code(204).send();
    }
  );
};
