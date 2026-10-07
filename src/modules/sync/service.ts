import {
  type ChangesPage,
  MAX_BATCH,
  noteTagId,
  type PushBatch,
  type PushOutcome,
  parseNoteTagId,
} from '../../contract/index.ts';
import type { Clock } from '../../shared/clock.ts';
import { BadRequest, Gone } from '../../shared/errors.ts';
import type { Store, StoreTx } from '../../store/Store.ts';
import { decide } from './decide.ts';
import type { Client, LiveUpdates } from './liveUpdates.ts';

export type FeedPage = Pick<ChangesPage, 'notes' | 'tags' | 'noteTags' | 'tombstones' | 'seq'> & {
  /** The cursor of the following page; null once this page reaches the Account's Sequence. */
  next: { since: number; from: number } | null;
};

async function applyPush(
  tx: StoreTx,
  accountId: string,
  batch: PushBatch,
  now: string
): Promise<{ outcomes: PushOutcome[]; seq: number; advanced: boolean }> {
  const { sync } = tx;
  // Before any read, so pushes to one Account run one after another (Store.ts).
  await tx.accounts.lock(accountId, 'write');
  const start = (await sync.sequence(accountId)).seq;
  let seq = start;
  const outcomes: PushOutcome[] = [];

  for (const { rev, ...note } of batch.notes) {
    const existing = await sync.note(accountId, note.id);
    const tombstoned = await sync.isTombstoned(accountId, 'note', note.id);
    const decision = decide({ kind: 'note', rev }, existing, tombstoned);
    if (decision.status === 'accepted') {
      await sync.putNote(accountId, { ...note, rev: decision.rev }, ++seq);
      outcomes.push({ kind: 'note', id: note.id, status: 'accepted', rev: decision.rev });
    } else if (decision.status === 'conflict' && existing) {
      outcomes.push({ kind: 'note', id: note.id, status: 'conflict', server: existing });
    } else {
      outcomes.push({ kind: 'note', id: note.id, status: 'gone' });
    }
  }

  for (const { rev, ...tag } of batch.tags) {
    const existing = await sync.tag(accountId, tag.id);
    const tombstoned = await sync.isTombstoned(accountId, 'tag', tag.id);
    const decision = decide({ kind: 'tag', rev }, existing, tombstoned);
    if (decision.status === 'accepted') {
      await sync.putTag(accountId, { ...tag, rev: decision.rev }, ++seq);
      outcomes.push({ kind: 'tag', id: tag.id, status: 'accepted', rev: decision.rev });
    } else if (decision.status === 'conflict' && existing) {
      outcomes.push({ kind: 'tag', id: tag.id, status: 'conflict', server: existing });
    } else {
      outcomes.push({ kind: 'tag', id: tag.id, status: 'gone' });
    }
  }

  for (const { rev, ...link } of batch.noteTags) {
    const id = noteTagId(link.noteId, link.tagId);
    const existing = await sync.noteTag(accountId, link.noteId, link.tagId);
    const orphan =
      !(await sync.note(accountId, link.noteId)) || !(await sync.tag(accountId, link.tagId));
    const decision = decide({ kind: 'noteTag', rev }, existing, orphan);
    if (decision.status === 'accepted') {
      await sync.putNoteTag(accountId, { ...link, rev: decision.rev }, ++seq);
      // Re-linking after an unlink: the row now says more than the old Tombstone.
      await sync.removeTombstone(accountId, 'noteTag', id);
      outcomes.push({ kind: 'noteTag', id, status: 'accepted', rev: decision.rev });
    } else {
      outcomes.push({ kind: 'noteTag', id, status: 'gone' });
    }
  }

  for (const { kind, id, rev } of batch.tombstones) {
    // The contract guarantees a noteTag id parses.
    const pair = kind === 'noteTag' ? parseNoteTagId(id) : null;
    const note = kind === 'note' ? await sync.note(accountId, id) : undefined;
    const tag = kind === 'tag' ? await sync.tag(accountId, id) : undefined;
    const link = pair ? await sync.noteTag(accountId, pair.noteId, pair.tagId) : undefined;
    const decision = decide(
      { kind: 'tombstone', of: kind, rev },
      note ?? tag ?? link,
      await sync.isTombstoned(accountId, kind, id)
    );
    if (decision.status === 'conflict') {
      // Stale: the Device keeps the server's version.
      if (note) outcomes.push({ kind: 'note', id, status: 'conflict', server: note });
      if (tag) outcomes.push({ kind: 'tag', id, status: 'conflict', server: tag });
      continue;
    }
    if (decision.status !== 'accepted') throw new Error('A Tombstone is never gone');
    if (decision.write === 'tombstone') {
      // Devices drop a purged Note's or Tag's links themselves; no noteTag Tombstones are written.
      if (kind === 'note') await sync.removeNote(accountId, id);
      else if (kind === 'tag') await sync.removeTag(accountId, id);
      else if (pair) await sync.removeNoteTag(accountId, pair.noteId, pair.tagId);
      // The server's clock, not the Device's, decides when the Tombstone leaves the window.
      await sync.addTombstone(accountId, { kind, id, deletedAt: now }, ++seq);
    }
    outcomes.push({ kind, id, status: 'accepted', rev: decision.rev });
  }

  const advanced = seq !== start;
  if (advanced) await sync.setSequence(accountId, seq);
  return { outcomes, seq, advanced };
}

/** The push and the change feed (ADR 0002). */
export class SyncService {
  readonly #store: Store;
  readonly #clock: Clock;
  readonly #live: LiveUpdates;
  readonly #pageSize: number;

  constructor(store: Store, clock: Clock, live: LiveUpdates, pageSize: number) {
    this.#store = store;
    this.#clock = clock;
    this.#live = live;
    this.#pageSize = pageSize;
  }

  async push(
    accountId: string,
    deviceId: string,
    batch: PushBatch
  ): Promise<{ outcomes: PushOutcome[]; seq: number }> {
    const size =
      batch.notes.length + batch.tags.length + batch.noteTags.length + batch.tombstones.length;
    if (size > MAX_BATCH) {
      throw new BadRequest(`A push carries at most ${MAX_BATCH} rows; split it`);
    }
    const now = this.#clock().toISOString();
    const { outcomes, seq, advanced } = await this.#store.transaction((tx) =>
      applyPush(tx, accountId, batch, now)
    );
    // After the commit; the pushing Device already has these rows.
    if (advanced) this.#live.notify(accountId, seq, deviceId);
    return { outcomes, seq };
  }

  /** `from` is where a paged pull began; the 410 check judges it, not the current page. */
  async page(accountId: string, since: number, from: number | undefined): Promise<FeedPage> {
    const origin = from ?? since;
    const limit = this.#pageSize;
    // One transaction holding the Account, so a push between the reads cannot split the page.
    const { seq, changes } = await this.#store.transaction(async (tx) => {
      await tx.accounts.lock(accountId, 'read');
      const { seq, prunedSeq } = await tx.sync.sequence(accountId);
      // A Device starting from 0 holds nothing, so it cannot have missed a removed Tombstone.
      // A cursor past the Sequence was issued before a restore rewound the database.
      if ((origin > 0 && origin < prunedSeq) || since > seq) {
        throw new Gone('Cursor is older than the tombstone window; resync');
      }
      return { seq, changes: await tx.sync.changesSince(accountId, since, limit) };
    });

    const page: Pick<ChangesPage, 'notes' | 'tags' | 'noteTags' | 'tombstones'> = {
      notes: [],
      tags: [],
      noteTags: [],
      tombstones: [],
    };
    const entries = [
      ...changes.notes.map(({ seq, record }) => ({ seq, put: () => page.notes.push(record) })),
      ...changes.tags.map(({ seq, record }) => ({ seq, put: () => page.tags.push(record) })),
      ...changes.noteTags.map(({ seq, record }) => ({
        seq,
        put: () => page.noteTags.push(record),
      })),
      ...changes.tombstones.map(({ seq, record }) => ({
        seq,
        put: () => page.tombstones.push(record),
      })),
    ]
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    for (const entry of entries) entry.put();

    const last = entries.at(-1);
    const next = entries.length === limit && last ? { since: last.seq, from: origin } : null;
    return { ...page, seq, next };
  }

  async seq(accountId: string): Promise<number> {
    return (await this.#store.sync.sequence(accountId)).seq;
  }

  subscribe(accountId: string, deviceId: string, client: Client): () => void {
    return this.#live.add(accountId, deviceId, client);
  }
}
