import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  Account,
  AccountsResponse,
  CreateAccountRequest,
  Id,
  PasswordRequest,
  SessionResponse,
} from '../../contract/index.ts';
import { SIGN_IN_RATE_LIMIT } from '../../http/security.ts';
import { setSessionCookie } from '../../http/sessionCookie.ts';
import { sessionBody } from '../sessions/presenter.ts';
import { accountBody, accountsBody } from './presenter.ts';

export const accountRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/api/accounts',
    {
      config: { rateLimit: SIGN_IN_RATE_LIMIT },
      schema: {
        summary: 'Spend an Invite: create a member Account and sign this Device in',
        tags: ['accounts'],
        body: CreateAccountRequest,
        response: { 201: SessionResponse },
      },
    },
    async (request, reply) => {
      const { deviceName, ...account } = request.body;
      const member = await app.services.accounts.createMember(account);
      const { token, device } = await app.services.sessions.open(member, deviceName);
      setSessionCookie(reply, token, app.config.sessionTtlDays);
      reply.code(201);
      return sessionBody(member, device);
    }
  );

  app.get(
    '/api/accounts',
    {
      config: { auth: 'owner' },
      schema: {
        summary: "Every Account on the server, the Owner's included (Owner only)",
        tags: ['accounts'],
        response: { 200: AccountsResponse },
      },
    },
    async () => accountsBody(await app.services.accounts.list())
  );

  app.get(
    '/api/accounts/:id',
    {
      config: { auth: 'owner' },
      schema: {
        summary: 'One Account (Owner only)',
        tags: ['accounts'],
        params: z.object({ id: Id }),
        response: { 200: Account },
      },
    },
    async (request) => accountBody(await app.services.accounts.get(request.params.id))
  );

  app.put(
    '/api/accounts/:id/password',
    {
      config: { auth: 'owner' },
      schema: {
        summary: "Replace an Account's password (Owner only); its Devices stay signed in",
        tags: ['accounts'],
        params: z.object({ id: Id }),
        body: PasswordRequest,
      },
    },
    async (request, reply) => {
      await app.services.accounts.setPassword(request.params.id, request.body.password);
      return reply.code(204).send();
    }
  );
};
