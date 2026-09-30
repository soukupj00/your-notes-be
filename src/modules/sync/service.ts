import { and, asc, eq, gt } from 'drizzle-orm';
import {
  type ChangesPage,
  MAX_BATCH,
  noteTagId,
  type PushBatch,
  type PushOutcome,
  parseNoteTagId,
  type Tombstone,
} from '../../contract/index.ts';
import type { Db } from '../../db/client.ts';
import {
  noteFromRow,
  noteTagFromRow,
  noteTagToRow,
  noteToRow,
  tagFromRow,
  tagToRow,
  tombstoneFromRow,
} from '../../db/rows.ts';
import { accounts, notes, noteTags, tags, tombstones } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { BadRequest, Gone } from '../../shared/errors.ts';
import { decide } from './decide.ts';
import type { Client, LiveUpdates } from './liveUpdates.ts';

export type FeedPage = Pick<ChangesPage, 'notes' | 'tags' | 'noteTags' | 'tombstones' | 'seq'> & {
  /** The cursor of the following page; null once this page reaches the Account's Sequence. */
  next: { since: number; from: number } | null;
};

/** Runs inside the caller's transaction; every accepted row takes the next Sequence. */
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

/** The push and the change feed (ADR 0002), and the Live Update hints that follow a push. */
export class SyncService {
  readonly #db: Db;
  readonly #clock: Clock;
  readonly #live: LiveUpdates;
  readonly #pageSize: number;

  constructor(db: Db, clock: Clock, live: LiveUpdates, pageSize: number) {
    this.#db = db;
    this.#clock = clock;
    this.#live = live;
    this.#pageSize = pageSize;
  }

  push(
    accountId: string,
    deviceId: string,
    batch: PushBatch
  ): { outcomes: PushOutcome[]; seq: number } {
    const size =
      batch.notes.length + batch.tags.length + batch.noteTags.length + batch.tombstones.length;
    if (size > MAX_BATCH) {
      throw new BadRequest(`A push carries at most ${MAX_BATCH} rows; split it`);
    }
    const now = this.#clock().toISOString();
    const { outcomes, seq, advanced } = this.#db.$client.transaction(() =>
      applyPush(this.#db, accountId, batch, now)
    )();
    // After the commit; the pushing Device already has these rows.
    if (advanced) this.#live.notify(accountId, seq, deviceId);
    return { outcomes, seq };
  }

  /** `from` is where a paged pull began; the 410 check judges it, not the current page. */
  page(accountId: string, since: number, from: number | undefined): FeedPage {
    const origin = from ?? since;
    const { seq, prunedSeq } = this.#db
      .select({ seq: accounts.seq, prunedSeq: accounts.prunedSeq })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .get() ?? { seq: 0, prunedSeq: 0 };
    // A Device starting from 0 holds nothing, so it cannot have missed a removed Tombstone.
    // A cursor past the Sequence was issued before a restore rewound the database.
    if ((origin > 0 && origin < prunedSeq) || since > seq) {
      throw new Gone('Cursor is older than the tombstone window; resync');
    }

    // Up to a page from each kind, merged by Sequence and cut to one page (ADR 0002).
    const limit = this.#pageSize;
    const page: Pick<ChangesPage, 'notes' | 'tags' | 'noteTags' | 'tombstones'> = {
      notes: [],
      tags: [],
      noteTags: [],
      tombstones: [],
    };
    const after = <T extends typeof notes | typeof tags | typeof noteTags | typeof tombstones>(
      table: T
    ) => and(eq(table.accountId, accountId), gt(table.seq, since));
    const entries = [
      ...this.#db
        .select()
        .from(notes)
        .where(after(notes))
        .orderBy(asc(notes.seq))
        .limit(limit)
        .all()
        .map((row) => ({ seq: row.seq, put: () => page.notes.push(noteFromRow(row)) })),
      ...this.#db
        .select()
        .from(tags)
        .where(after(tags))
        .orderBy(asc(tags.seq))
        .limit(limit)
        .all()
        .map((row) => ({ seq: row.seq, put: () => page.tags.push(tagFromRow(row)) })),
      ...this.#db
        .select()
        .from(noteTags)
        .where(after(noteTags))
        .orderBy(asc(noteTags.seq))
        .limit(limit)
        .all()
        .map((row) => ({ seq: row.seq, put: () => page.noteTags.push(noteTagFromRow(row)) })),
      ...this.#db
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
    const next = entries.length === limit && last ? { since: last.seq, from: origin } : null;
    return { ...page, seq, next };
  }

  seq(accountId: string): number {
    return (
      this.#db.select({ seq: accounts.seq }).from(accounts).where(eq(accounts.id, accountId)).get()
        ?.seq ?? 0
    );
  }

  /** Ends any earlier stream of the same Device; returns the unsubscribe. */
  subscribe(accountId: string, deviceId: string, client: Client): () => void {
    return this.#live.add(accountId, deviceId, client);
  }
}
