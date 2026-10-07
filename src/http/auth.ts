import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SessionAccount } from '../modules/accounts/service.ts';
import type { SessionDevice } from '../modules/sessions/service.ts';
import { sendEarlyProblem } from './errors.ts';
import { clearSessionCookie, SESSION_COOKIE } from './sessionCookie.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook, the only code that reads the cookie. */
    account: SessionAccount | null;
    device: SessionDevice | null;
  }
  interface FastifyContextConfig {
    /** `true`: 401 without a Session. `'owner'`: also 403 when the Account is not the Owner. */
    auth?: boolean | 'owner';
  }
}

/** Registered after `@fastify/cookie`, whose own hook parses the cookie this one reads. */
export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('account', null);
  app.decorateRequest('device', null);

  app.addHook('onRequest', async (request, reply) => {
    const required = request.routeOptions.config.auth;
    // Public routes (the PWA, setup, Share Links) neither read nor clear the cookie.
    if (!required) return;
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const session = await app.services.sessions.resolve(token);
      if (session) {
        request.account = session.account;
        request.device = session.device;
      } else {
        clearSessionCookie(reply);
      }
    }
    if (!request.account) return sendEarlyProblem(request, reply, 401, 'Sign in first');
    if (required === 'owner' && request.account.role !== 'owner') {
      return sendEarlyProblem(request, reply, 403, 'Only the Owner can do this');
    }
  });
}

/** The Session behind a request on an `auth` route, where the hook has already answered 401. */
export function sessionOf(request: FastifyRequest): {
  account: SessionAccount;
  device: SessionDevice;
} {
  const { account, device } = request;
  if (!account || !device) throw new Error(`${request.url} reads the Session without auth`);
  return { account, device };
}
