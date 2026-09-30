import { and, eq, gt } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { clearSessionCookie } from '../auth/sessions.ts';
import { DevicesResponse, Id } from '../contract/index.ts';
import { sessions } from '../db/schema.ts';
import { hal, link } from '../hal.ts';
import { sessionOf } from '../plugins/auth.ts';
import { NotFound } from '../shared/errors.ts';

/** A Device is a Session seen from the person's side; revoking one ends its Session. */
export const deviceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/api/devices',
    {
      config: { auth: true },
      schema: {
        summary: "The signed-in Account's Devices",
        tags: ['devices'],
        response: { 200: DevicesResponse },
      },
    },
    async (request) => {
      const { account, device: current } = sessionOf(request);
      const rows = app.db
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.accountId, account.id), gt(sessions.expiresAt, app.now().toISOString()))
        )
        .orderBy(sessions.createdAt)
        .all();
      const devices = rows.map((row) =>
        hal(
          {
            id: row.id,
            name: row.deviceName,
            createdAt: row.createdAt,
            lastSeenAt: row.lastSeenAt,
            current: row.id === current.id,
          },
          { self: link(`/api/devices/${row.id}`) }
        )
      );
      return hal({}, { self: link('/api/devices') }, { devices });
    }
  );

  app.delete(
    '/api/devices/:id',
    {
      config: { auth: true },
      schema: {
        summary: 'Revoke a Device: end its Session',
        tags: ['devices'],
        params: z.object({ id: Id }),
      },
    },
    async (request, reply) => {
      const { account, device } = sessionOf(request);
      const deleted = app.db
        .delete(sessions)
        .where(and(eq(sessions.id, request.params.id), eq(sessions.accountId, account.id)))
        .returning({ id: sessions.id })
        .get();
      if (!deleted) throw new NotFound('No such Device');
      if (deleted.id === device.id) clearSessionCookie(reply);
      return reply.code(204).send();
    }
  );
};
