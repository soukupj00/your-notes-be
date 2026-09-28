import type { FastifyInstance } from 'fastify';
import { sendProblem } from '../problem.ts';

export type RequestAccount = { id: string };
export type RequestDevice = { id: string };

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in Account, or null; set by the auth hook, the only code that reads the cookie. */
    account: RequestAccount | null;
    device: RequestDevice | null;
  }
  interface FastifyContextConfig {
    /** When true, the route answers 401 to a request without a Session. */
    auth?: boolean;
  }
}

export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('account', null);
  app.decorateRequest('device', null);

  app.addHook('onRequest', async (request, reply) => {
    // B2 resolves the session cookie into request.account and request.device here.
    if (request.routeOptions.config.auth && !request.account) {
      return sendProblem(reply, 401, 'Sign in first');
    }
  });
}
