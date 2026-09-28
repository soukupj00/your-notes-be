import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { mintCode } from '../auth/codes.ts';
import { CodeRequest, CodeResponse } from '../contract/index.ts';
import { sessionOf } from '../plugins/auth.ts';
import { sendProblem } from '../problem.ts';

/** Pairing Codes (ADR 0001): `device` adds a Device to this Account, `invite` (Owner) a member. */
export const codeRoutes: FastifyPluginAsyncZod = async (app) => {
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
      const { account } = sessionOf(request);
      const { kind } = request.body;
      if (kind === 'invite' && account.role !== 'owner') {
        return sendProblem(reply, 403, 'Only the Owner can invite');
      }
      const { code, expiresAt } = mintCode(app.db, kind, account.id, app.now());
      return reply.code(201).send({ code, kind, expiresAt });
    }
  );
};
