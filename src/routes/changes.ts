import { createHash } from 'node:crypto';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ChangesPage,
  MAX_BATCH,
  noteTagId,
  PushBatch,
  type PushOutcome,
  PushResponse,
  parseNoteTagId,
  type Tombstone,
} from '../contract/index.ts';
import type { Db } from '../db/client.ts';
import {
  noteFromRow,
  noteTagFromRow,
  noteTagToRow,
  noteToRow,
  tagFromRow,
  tagToRow,
  tombstoneFromRow,
} from '../db/rows.ts';
import { accounts, notes, noteTags, tags, tombstones } from '../db/schema.ts';
import { hal, link } from '../hal.ts';
import { sessionOf } from '../plugins/auth.ts';
import { sendProblem } from '../problem.ts';
import { decide } from '../sync/decide.ts';

/**
 * Applies one push inside the caller's transaction: every accepted row gets its new `rev` and
 * the next Sequence. Returns the outcomes in input order and the Account's Sequence after.
 */
function applyPush(
  db: Db,
  accountId: string,
  batch: PushBatch,
  now: string
): { outcomes: PushOutcome[]; seq: number; advanced: boolean } {
  const start =
    db.select({ seq: accounts.seq }).from(accounts).where(eq(accounts.id, accountId)).get()?.seq ??
    0;
  let seq = start;
  const outcomes: PushOutcome[] = [];
  const tombstoned = (kind: Tombstone['kind'], id: string) =>
    db
      .select({ id: tombstones.id })
      .from(tombstones)
      .where(
        and(eq(tombstones.accountId, accountId), eq(tombstones.kind, kind), eq(tombstones.id, id))
      )
      .get() !== undefined;
  const noteRow = (id: string) =>
    db
      .select()
      .from(notes)
      .where(and(eq(notes.accountId, accountId), eq(notes.id, id)))
      .get();
  const tagRow = (id: string) =>
    db
      .select()
      .from(tags)
      .where(and(eq(tags.accountId, accountId), eq(tags.id, id)))
      .get();
  const linkWhere = (noteId: string, tagId: string) =>
    and(eq(noteTags.accountId, accountId), eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId));

  for (const { rev, ...note } of batch.notes) {
    const existing = noteRow(note.id);
    const decision = decide({ kind: 'note', rev }, existing, tombstoned('note', note.id));
    if (decision.status === 'accepted') {
      const row = noteToRow(accountId, note, decision.rev, ++seq);
      db.insert(notes)
        .values(row)
        .onConflictDoUpdate({ target: [notes.accountId, notes.id], set: row })
        .run();
      outcomes.push({ kind: 'note', id: note.id, status: 'accepted', rev: decision.rev });
    } else if (decision.status === 'conflict' && existing) {
      outcomes.push({
        kind: 'note',
        id: note.id,
        status: 'conflict',
        server: noteFromRow(existing),
      });
    } else {
      outcomes.push({ kind: 'note', id: note.id, status: 'gone' });
    }
  }

  for (const { rev, ...tag } of batch.tags) {
    const existing = tagRow(tag.id);
    const decision = decide({ kind: 'tag', rev }, existing, tombstoned('tag', tag.id));
    if (decision.status === 'accepted') {
      const row = tagToRow(accountId, tag, decision.rev, ++seq);
      db.insert(tags)
        .values(row)
        .onConflictDoUpdate({ target: [tags.accountId, tags.id], set: row })
        .run();
      outcomes.push({ kind: 'tag', id: tag.id, status: 'accepted', rev: decision.rev });
    } else if (decision.status === 'conflict' && existing) {
      outcomes.push({ kind: 'tag', id: tag.id, status: 'conflict', server: tagFromRow(existing) });
    } else {
      outcomes.push({ kind: 'tag', id: tag.id, status: 'gone' });
    }
  }

  for (const { rev, ...noteTag } of batch.noteTags) {
    const id = noteTagId(noteTag.noteId, noteTag.tagId);
    const existing = db
      .select()
      .from(noteTags)
      .where(linkWhere(noteTag.noteId, noteTag.tagId))
      .get();
    const orphan = !noteRow(noteTag.noteId) || !tagRow(noteTag.tagId);
    const decision = decide({ kind: 'noteTag', rev }, existing, orphan);
    if (decision.status === 'accepted') {
      const row = noteTagToRow(accountId, noteTag, decision.rev, ++seq);
      db.insert(noteTags)
        .values(row)
        .onConflictDoUpdate({
          target: [noteTags.accountId, noteTags.noteId, noteTags.tagId],
          set: row,
        })
        .run();
      // Re-linking after an unlink: the row now says more than the old Tombstone.
      db.delete(tombstones)
        .where(
          and(
            eq(tombstones.accountId, accountId),
            eq(tombstones.kind, 'noteTag'),
            eq(tombstones.id, id)
          )
        )
        .run();
      outcomes.push({ kind: 'noteTag', id, status: 'accepted', rev: decision.rev });
    } else {
      outcomes.push({ kind: 'noteTag', id, status: 'gone' });
    }
  }

  for (const tombstone of batch.tombstones) {
    const { kind, id, rev } = tombstone;
    // The contract guarantees a noteTag id parses.
    const pair = kind === 'noteTag' ? parseNoteTagId(id) : null;
    const note = kind === 'note' ? noteRow(id) : undefined;
    const tag = kind === 'tag' ? tagRow(id) : undefined;
    const noteTag = pair
      ? db.select().from(noteTags).where(linkWhere(pair.noteId, pair.tagId)).get()
      : undefined;
    const decision = decide(
      { kind: 'tombstone', of: kind, rev },
      note ?? tag ?? noteTag,
      tombstoned(kind, id)
    );
    if (decision.status === 'conflict') {
      // Stale: nothing written; the Device keeps the server's version.
      if (note) outcomes.push({ kind: 'note', id, status: 'conflict', server: noteFromRow(note) });
      if (tag) outcomes.push({ kind: 'tag', id, status: 'conflict', server: tagFromRow(tag) });
      continue;
    }
    if (decision.status !== 'accepted') throw new Error('A Tombstone is never gone');
    if (decision.write === 'tombstone') {
      if (kind === 'note') {
        db.delete(notes)
          .where(and(eq(notes.accountId, accountId), eq(notes.id, id)))
          .run();
        // Devices drop a purged Note's links themselves; no noteTag Tombstones are written.
        db.delete(noteTags)
          .where(and(eq(noteTags.accountId, accountId), eq(noteTags.noteId, id)))
          .run();
      } else if (kind === 'tag') {
        db.delete(tags)
          .where(and(eq(tags.accountId, accountId), eq(tags.id, id)))
          .run();
        db.delete(noteTags)
          .where(and(eq(noteTags.accountId, accountId), eq(noteTags.tagId, id)))
          .run();
      } else if (pair) {
        db.delete(noteTags).where(linkWhere(pair.noteId, pair.tagId)).run();
      }
      // The server's clock, not the Device's, decides when the Tombstone leaves the window.
      db.insert(tombstones).values({ accountId, kind, id, seq: ++seq, deletedAt: now }).run();
    }
    outcomes.push({ kind, id, status: 'accepted', rev: decision.rev });
  }

  const advanced = seq !== start;
  if (advanced) db.update(accounts).set({ seq }).where(eq(accounts.id, accountId)).run();
  return { outcomes, seq, advanced };
}

function etagOf(body: unknown): string {
  return `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`;
}

export const changeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/api/changes',
    {
      config: { auth: true },
      schema: {
        summary: 'Push a batch: one transaction, one outcome per row in input order',
        tags: ['sync'],
        body: PushBatch,
        response: { 200: PushResponse },
      },
    },
    async (request, reply) => {
      const { account, device } = sessionOf(request);
      const batch = request.body;
      const size =
        batch.notes.length + batch.tags.length + batch.noteTags.length + batch.tombstones.length;
      if (size > MAX_BATCH) {
        return sendProblem(reply, 400, `A push carries at most ${MAX_BATCH} rows; split it`);
      }
      const now = app.now().toISOString();
      const { outcomes, seq, advanced } = app.db.$client.transaction(() =>
        applyPush(app.db, account.id, batch, now)
      )();
      // After the commit; the pushing Device already has these rows.
      if (advanced) app.live.notify(account.id, seq, device.id);
      return hal({ outcomes, seq }, { self: link('/api/changes'), changes: link('/api/changes') });
    }
  );

  app.get(
    '/api/changes',
    {
      config: { auth: true },
      schema: {
        summary: 'One page of the change feed after a Sequence; follow `next` until it is absent',
        tags: ['sync'],
        querystring: z.object({ since: z.coerce.number().int().min(0).default(0) }),
        response: {
          200: ChangesPage,
          304: z.undefined().describe('Not modified: the ETag matched'),
        },
      },
    },
    async (request, reply) => {
      const { account } = sessionOf(request);
      const { since } = request.query;
      const { seq, prunedSeq } = app.db
        .select({ seq: accounts.seq, prunedSeq: accounts.prunedSeq })
        .from(accounts)
        .where(eq(accounts.id, account.id))
        .get() ?? { seq: 0, prunedSeq: 0 };
      // A Device starting from 0 holds nothing, so it cannot have missed a removed Tombstone.
      // A cursor past the Sequence was issued before a restore rewound the database.
      if ((since > 0 && since < prunedSeq) || since > seq) {
        return sendProblem(reply, 410, 'Cursor is older than the tombstone window; resync');
      }

      // Up to a page from each kind, merged by Sequence and cut to one page (ADR 0002).
      const limit = app.config.pageSize;
      const page: Pick<ChangesPage, 'notes' | 'tags' | 'noteTags' | 'tombstones'> = {
        notes: [],
        tags: [],
        noteTags: [],
        tombstones: [],
      };
      const after = <T extends typeof notes | typeof tags | typeof noteTags | typeof tombstones>(
        table: T
      ) => and(eq(table.accountId, account.id), gt(table.seq, since));
      const entries = [
        ...app.db
          .select()
          .from(notes)
          .where(after(notes))
          .orderBy(asc(notes.seq))
          .limit(limit)
          .all()
          .map((row) => ({ seq: row.seq, put: () => page.notes.push(noteFromRow(row)) })),
        ...app.db
          .select()
          .from(tags)
          .where(after(tags))
          .orderBy(asc(tags.seq))
          .limit(limit)
          .all()
          .map((row) => ({ seq: row.seq, put: () => page.tags.push(tagFromRow(row)) })),
        ...app.db
          .select()
          .from(noteTags)
          .where(after(noteTags))
          .orderBy(asc(noteTags.seq))
          .limit(limit)
          .all()
          .map((row) => ({ seq: row.seq, put: () => page.noteTags.push(noteTagFromRow(row)) })),
        ...app.db
          .select()
          .from(tombstones)
          .where(after(tombstones))
          .orderBy(asc(tombstones.seq))
          .limit(limit)
          .all()
          .map((row) => ({
            seq: row.seq,
            put: () => page.tombstones.push(tombstoneFromRow(row)),
          })),
      ]
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit);
      for (const entry of entries) entry.put();

      const last = entries.at(-1);
      const body = hal(
        { ...page, seq },
        {
          self: link(`/api/changes?since=${since}`),
          ...(entries.length === limit && last
            ? { next: link(`/api/changes?since=${last.seq}`) }
            : {}),
          stream: link('/api/changes/stream'),
        }
      );
      const etag = etagOf(body);
      reply.header('etag', etag).header('cache-control', 'private, no-cache');
      const ifNoneMatch = request.headers['if-none-match'];
      if (ifNoneMatch?.split(',').some((tag) => tag.trim() === etag)) {
        return reply.code(304).send(undefined);
      }
      return body;
    }
  );
};
