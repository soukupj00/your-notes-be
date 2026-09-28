import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { newSecret } from '../auth/codes.ts';
import { Id, Share, SharedNote, ShareRequest, SharesResponse } from '../contract/index.ts';
import { noteFromRow } from '../db/rows.ts';
import { blobs, notes, shares } from '../db/schema.ts';
import { hal, link } from '../hal.ts';
import { sessionOf } from '../plugins/auth.ts';
import { sendProblem } from '../problem.ts';
import { sendBlob } from './blobs.ts';

/** Per IP on the two unauthenticated routes: enough to read a Note and its pictures. */
const PUBLIC_RATE_LIMIT = { max: 60, timeWindow: '1 minute' };

/** A revoked, unknown or trashed share, and a blob it does not list, all read the same. */
const NOT_SHARED = 'Nothing is shared here';

const Token = z.string().min(1).max(128);

function shareBody(row: typeof shares.$inferSelect): Share {
  return hal(
    { id: row.id, noteId: row.noteId, token: row.token, createdAt: row.createdAt },
    { self: link(`/api/shares/${row.id}`), public: link(`/api/public/shares/${row.token}`) }
  );
}

/** Share Links (ADR 0005): the Account's own routes, then the public ones under `/api/public`. */
export const shareRoutes: FastifyPluginAsyncZod = async (app) => {
  /** The shared Note, unless the share is gone or the Note is gone or trashed. */
  const sharedNote = (token: string) => {
    const share = app.db.select().from(shares).where(eq(shares.token, token)).get();
    if (!share) return undefined;
    const note = app.db
      .select()
      .from(notes)
      .where(and(eq(notes.accountId, share.accountId), eq(notes.id, share.noteId)))
      .get();
    return note && note.state !== 'trashed' ? note : undefined;
  };

  app.post(
    '/api/shares',
    {
      config: { auth: true },
      schema: {
        summary: 'Share a Note read-only; sharing it again returns the same Share Link',
        tags: ['shares'],
        body: ShareRequest,
        response: { 200: Share, 201: Share },
      },
    },
    async (request, reply) => {
      const { account } = sessionOf(request);
      const { noteId } = request.body;
      const note = app.db
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.accountId, account.id), eq(notes.id, noteId)))
        .get();
      if (!note) return sendProblem(reply, 404, 'No such Note');
      const mine = and(eq(shares.accountId, account.id), eq(shares.noteId, noteId));
      const existing = app.db.select().from(shares).where(mine).get();
      if (existing) return reply.code(200).send(shareBody(existing));
      const row = {
        id: randomUUID(),
        accountId: account.id,
        noteId,
        token: newSecret(),
        createdAt: app.now().toISOString(),
      };
      app.db.insert(shares).values(row).run();
      return reply.code(201).send(shareBody(row));
    }
  );

  app.get(
    '/api/shares',
    {
      config: { auth: true },
      schema: {
        summary: "The signed-in Account's Share Links",
        tags: ['shares'],
        response: { 200: SharesResponse },
      },
    },
    async (request) => {
      const { account } = sessionOf(request);
      const rows = app.db
        .select()
        .from(shares)
        .where(eq(shares.accountId, account.id))
        .orderBy(shares.createdAt)
        .all();
      return hal({}, { self: link('/api/shares') }, { shares: rows.map(shareBody) });
    }
  );

  app.get(
    '/api/shares/:id',
    {
      config: { auth: true },
      schema: {
        summary: 'One Share Link',
        tags: ['shares'],
        params: z.object({ id: Id }),
        response: { 200: Share },
      },
    },
    async (request, reply) => {
      const { account } = sessionOf(request);
      const row = app.db
        .select()
        .from(shares)
        .where(and(eq(shares.id, request.params.id), eq(shares.accountId, account.id)))
        .get();
      return row ? shareBody(row) : sendProblem(reply, 404, 'No such Share Link');
    }
  );

  app.delete(
    '/api/shares/:id',
    {
      config: { auth: true },
      schema: {
        summary: 'Revoke a Share Link; the link stops working at once',
        tags: ['shares'],
        params: z.object({ id: Id }),
      },
    },
    async (request, reply) => {
      const { account } = sessionOf(request);
      const deleted = app.db
        .delete(shares)
        .where(and(eq(shares.id, request.params.id), eq(shares.accountId, account.id)))
        .returning({ id: shares.id })
        .get();
      if (!deleted) return sendProblem(reply, 404, 'No such Share Link');
      return reply.code(204).send();
    }
  );

  app.get(
    '/api/public/shares/:token',
    {
      config: { rateLimit: PUBLIC_RATE_LIMIT },
      schema: {
        summary: 'Read a shared Note; no Session needed, only the token',
        tags: ['shares'],
        params: z.object({ token: Token }),
        response: { 200: SharedNote },
      },
    },
    async (request, reply) => {
      const { token } = request.params;
      const note = sharedNote(token);
      if (!note) return sendProblem(reply, 404, NOT_SHARED);
      const { rev: _rev, ...shown } = noteFromRow(note);
      reply.header('cache-control', 'private, no-cache');
      return hal(
        { note: shown },
        {
          self: link(`/api/public/shares/${token}`),
          blobs: link(`/api/public/shares/${token}/blobs/{id}`, { templated: true }),
        }
      );
    }
  );

  app.route({
    method: ['GET', 'HEAD'],
    url: '/api/public/shares/:token/blobs/:id',
    config: { rateLimit: PUBLIC_RATE_LIMIT },
    schema: {
      summary: "An Attachment's bytes, only for Attachments of the shared Note",
      tags: ['shares'],
      params: z.object({ token: Token, id: Id }),
    },
    handler: async (request, reply) => {
      const { token, id } = request.params;
      const note = sharedNote(token);
      const listed = note?.attachments?.some((attachment) => attachment.id === id);
      const row =
        note && listed
          ? app.db
              .select()
              .from(blobs)
              .where(and(eq(blobs.id, id), eq(blobs.accountId, note.accountId)))
              .get()
          : undefined;
      if (!row) return sendProblem(reply, 404, NOT_SHARED);
      return sendBlob(app, request, reply, row);
    },
  });
};
