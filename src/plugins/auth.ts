import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  clearSessionCookie,
  resolveSession,
  SESSION_COOKIE,
  type SessionAccount,
  type SessionDevice,
} from '../auth/sessions.ts';
import { sendProblem } from '../problem.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in Account, or null; set by the auth hook, the only code that reads the cookie. */
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
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const session = resolveSession(app.db, token, app.now());
      if (session) {
        request.account = session.account;
        request.device = session.device;
      } else {
        clearSessionCookie(reply);
      }
    }
    const required = request.routeOptions.config.auth;
    if (!required) return;
    if (!request.account) return sendProblem(reply, 401, 'Sign in first');
    if (required === 'owner' && request.account.role !== 'owner') {
      return sendProblem(reply, 403, 'Only the Owner can do this');
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
