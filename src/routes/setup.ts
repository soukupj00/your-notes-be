import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ownerExists, spendCode } from '../auth/codes.ts';
import { hashPassword } from '../auth/passwords.ts';
import { CreateAccountRequest, SessionResponse, SetupStatus } from '../contract/index.ts';
import { hal, link } from '../hal.ts';
import { NotFound, Unauthorized } from '../shared/errors.ts';
import { insertAccount } from './accounts.ts';
import { openSession, SIGN_IN_RATE_LIMIT, WRONG_CREDENTIALS } from './session.ts';

const ALREADY_SET_UP = 'This server already has an Owner';

/** First run (ADR 0001): only the setup code printed at startup can create the Owner. */
export const setupRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/api/setup',
    {
      schema: {
        summary: 'Whether the server still needs its Owner',
        tags: ['setup'],
        response: { 200: SetupStatus },
      },
    },
    async () => {
      if (ownerExists(app.db)) throw new NotFound(ALREADY_SET_UP);
      return hal({ needsSetup: true as const }, { self: link('/api/setup') });
    }
  );

  app.post(
    '/api/setup',
    {
      config: { rateLimit: SIGN_IN_RATE_LIMIT },
      schema: {
        summary: 'Spend the printed setup code: create the Owner and sign this Device in',
        tags: ['setup'],
        body: CreateAccountRequest,
        response: { 201: SessionResponse },
      },
    },
    async (request, reply) => {
      if (ownerExists(app.db)) throw new NotFound(ALREADY_SET_UP);
      const { code, username, password, deviceName } = request.body;
      const passwordHash = await hashPassword(password);
      const now = app.now();
      const owner = app.db.$client.transaction(() => {
        if (!spendCode(app.db, code, 'setup', now)) return null;
        return insertAccount(app.db, { username, passwordHash, role: 'owner', now });
      })();
      if (!owner) throw new Unauthorized(WRONG_CREDENTIALS);
      return openSession(app, reply, owner, deviceName);
    }
  );
};
