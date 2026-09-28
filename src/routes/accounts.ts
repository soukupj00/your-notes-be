import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { spendCode } from '../auth/codes.ts';
import { hashPassword } from '../auth/passwords.ts';
import type { SessionAccount } from '../auth/sessions.ts';
import { CreateAccountRequest, Id, PasswordRequest, SessionResponse } from '../contract/index.ts';
import type { Db } from '../db/client.ts';
import { accounts } from '../db/schema.ts';
import { sendProblem } from '../problem.ts';
import { openSession, SIGN_IN_RATE_LIMIT, WRONG_CREDENTIALS } from './session.ts';

class UsernameTaken extends Error {}

export function insertAccount(
  db: Db,
  {
    username,
    passwordHash,
    role,
    now,
  }: { username: string; passwordHash: string; role: SessionAccount['role']; now: Date }
): SessionAccount {
  const id = randomUUID();
  const at = now.toISOString();
  db.insert(accounts)
    .values({ id, username, passwordHash, role, createdAt: at, updatedAt: at })
    .run();
  return { id, username, role };
}

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
      const { code, username, password, deviceName } = request.body;
      const passwordHash = await hashPassword(password);
      const now = app.now();
      let member: SessionAccount | null;
      try {
        member = app.db.$client.transaction(() => {
          // Code first, so only a holder of a good Invite learns whether a username is taken.
          if (!spendCode(app.db, code, 'invite', now)) return null;
          const taken = app.db
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.username, username))
            .get();
          // Throwing rolls the spend back, so a taken name does not cost the Invite.
          if (taken) throw new UsernameTaken();
          return insertAccount(app.db, { username, passwordHash, role: 'member', now });
        })();
      } catch (error) {
        if (error instanceof UsernameTaken)
          return sendProblem(reply, 409, 'That username is taken');
        throw error;
      }
      if (!member) return sendProblem(reply, 401, WRONG_CREDENTIALS);
      return openSession(app, reply, member, deviceName);
    }
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
      const passwordHash = await hashPassword(request.body.password);
      const updated = app.db
        .update(accounts)
        .set({ passwordHash, updatedAt: app.now().toISOString() })
        .where(eq(accounts.id, request.params.id))
        .returning({ id: accounts.id })
        .get();
      if (!updated) return sendProblem(reply, 404, 'No such Account');
      return reply.code(204).send();
    }
  );
};
