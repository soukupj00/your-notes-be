import { randomUUID } from 'node:crypto';
import type { FastifyInstance, RawRequestDefaultExpression } from 'fastify';
import { sendProblem } from '../problem.ts';

/**
 * Static headers every response carries. A real Content-Security-Policy is its own later task,
 * tested against the built PWA (PLAN.md "Security").
 */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
} as const;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Reuses a well-formed incoming `X-Request-Id` so a proxy's id follows the request; else mints one. */
export function genReqId(req: RawRequestDefaultExpression): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export function registerSecurity(app: FastifyInstance): void {
  // CSRF: the session cookie is SameSite=Lax; this closes what Lax leaves open (PLAN.md "Security").
  app.addHook('onRequest', async (request, reply) => {
    if (SAFE_METHODS.has(request.method)) return;
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      return sendProblem(reply, 403, 'Cross-site requests may not change anything');
    }
  });

  app.addHook('onSend', async (request, reply) => {
    reply.headers(SECURITY_HEADERS);
    reply.header('x-request-id', request.id);
  });
}
