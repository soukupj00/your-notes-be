import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, RawRequestDefaultExpression } from 'fastify';
import { sendProblem } from './errors.ts';

/** No CSP for the PWA yet, a later task (PLAN.md "Security"); blob responses send their own. */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
} as const;

export function securityHeaders(requestId: string): Record<string, string> {
  return { ...SECURITY_HEADERS, 'x-request-id': requestId };
}

/** Per IP, on every route that accepts a password or a Pairing Code. */
export const SIGN_IN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;
// Must follow `shareLink` in the contract; unanchored, so a doubled slash is masked too.
const SHARE_TOKEN = /(\/share\/|\/api\/public\/shares\/)[^/?#]+/;

/** Masks the Share Link token in the request line: setup.md asks people to paste their logs. */
export const LOG_SERIALIZERS = {
  req: (request: FastifyRequest) => ({
    method: request.method,
    url: request.url.replace(SHARE_TOKEN, '$1***'),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  }),
};

/** A well-formed incoming `X-Request-Id` is kept, so a proxy's id follows the request. */
export function genReqId(req: RawRequestDefaultExpression): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export function registerSecurity(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    if (SAFE_METHODS.has(request.method)) return;
    // CSRF: only this origin, or no browser context at all, may change anything (PLAN.md).
    const site = request.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      return sendProblem(reply, 403, 'Cross-site requests may not change anything');
    }
  });

  app.addHook('onSend', async (request, reply) => {
    reply.headers(securityHeaders(request.id));
  });
}
