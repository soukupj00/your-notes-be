import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { Problem } from '../contract/index.ts';
import { BadRequest, Conflict, Forbidden, Gone, NotFound, Unauthorized } from '../shared/errors.ts';

const STATUS_OF = [
  [BadRequest, 400],
  [Unauthorized, 401],
  [Forbidden, 403],
  [NotFound, 404],
  [Conflict, 409],
  [Gone, 410],
] as const;

/** The server's errors (`shared/errors.ts`), or Fastify's, which carry their own status. */
type HandledError = Error & Partial<Pick<FastifyError, 'statusCode'>>;

export function sendProblem(
  reply: FastifyReply,
  status: number,
  detail?: string,
  errors?: Problem['errors']
): FastifyReply {
  const problem: Problem = {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    ...(detail === undefined ? {} : { detail }),
    ...(errors === undefined ? {} : { errors }),
  };
  return reply.code(status).type('application/problem+json').send(problem);
}

/** Every error leaves as RFC 9457 problem details; a 5xx never leaks its message. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: HandledError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const where = error.validationContext ?? 'request';
      const errors = error.validation.map((issue) => ({
        path: `${where}${issue.instancePath}`,
        message: issue.message ?? 'Invalid value',
      }));
      return sendProblem(reply, 400, 'The request does not match the schema', errors);
    }
    const status =
      STATUS_OF.find(([type]) => error instanceof type)?.[1] ?? error.statusCode ?? 500;
    if (status >= 400 && status < 500) return sendProblem(reply, status, error.message);
    request.log.error({ err: error }, 'request failed');
    return sendProblem(reply, 500);
  });
}
