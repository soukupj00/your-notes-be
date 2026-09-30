import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { spendCode } from '../auth/codes.ts';
import { verifyPassword } from '../auth/passwords.ts';
import {
  clearSessionCookie,
  createSession,
  type SessionAccount,
  type SessionDevice,
  sessionAccountColumns,
  setSessionCookie,
} from '../auth/sessions.ts';
import { SessionResponse, SignInRequest } from '../contract/index.ts';
import { accounts, sessions } from '../db/schema.ts';
import { hal, link } from '../hal.ts';
import { sessionOf } from '../plugins/auth.ts';
import { Unauthorized } from '../shared/errors.ts';

/** One answer for a wrong username, a wrong password and a bad code, so none can be told apart. */
export const WRONG_CREDENTIALS = 'Wrong credentials';

/** Per IP, on every route that accepts a password or a Pairing Code. */
export const SIGN_IN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

export function sessionBody(account: SessionAccount, device: SessionDevice): SessionResponse {
  return hal(
    { account, device },
    {
      self: link('/api/session'),
      devices: link('/api/devices'),
      codes: link('/api/codes'),
      changes: link('/api/changes'),
      blobs: link('/api/blobs/{id}', { templated: true }),
      shares: link('/api/shares'),
    }
  );
}

/** Signs this Device in: a new Session and its cookie; sets the 201. */
export function openSession(
  app: FastifyInstance,
  reply: FastifyReply,
  account: SessionAccount,
  deviceName: string
): SessionResponse {
  const ttlDays = app.config.sessionTtlDays;
  const { token, deviceId } = createSession(app.db, {
    accountId: account.id,
    deviceName,
    ttlDays,
    now: app.now(),
  });
  setSessionCookie(reply, token, ttlDays);
  reply.code(201);
  return sessionBody(account, { id: deviceId, name: deviceName });
}

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
      const body = request.body;
      let account: SessionAccount | undefined;
      if ('password' in body) {
        const row = app.db
          .select({ ...sessionAccountColumns, passwordHash: accounts.passwordHash })
          .from(accounts)
          .where(eq(accounts.username, body.username))
          .get();
        // Exactly one scrypt either way, so a wrong username costs what a wrong password does.
        const ok = await verifyPassword(body.password, row?.passwordHash);
        if (row && ok) account = { id: row.id, username: row.username, role: row.role };
      } else {
        const spent = spendCode(app.db, body.code, 'device', app.now());
        if (spent?.accountId) {
          account = app.db
            .select(sessionAccountColumns)
            .from(accounts)
            .where(eq(accounts.id, spent.accountId))
            .get();
        }
      }
      if (!account) throw new Unauthorized(WRONG_CREDENTIALS);
      return openSession(app, reply, account, body.deviceName);
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
      app.db
        .delete(sessions)
        .where(eq(sessions.id, sessionOf(request).device.id))
        .run();
      clearSessionCookie(reply);
      return reply.code(204).send();
    }
  );
};
