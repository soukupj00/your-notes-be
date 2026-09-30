import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.ts';
import { notes, shares } from '../../db/schema.ts';
import type { Clock } from '../../shared/clock.ts';
import { newSecret } from '../../shared/crypto.ts';
import { NotFound } from '../../shared/errors.ts';
import type { BlobRow, BlobService } from '../blobs/service.ts';

export type ShareRow = typeof shares.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;

/** A revoked, unknown or trashed share, and a blob it does not list, all read the same. */
const NOT_SHARED = 'Nothing is shared here';

/** Share Links (ADR 0005): one per Note, read by anyone holding the token. */
export class ShareService {
  readonly #db: Db;
  readonly #clock: Clock;
  readonly #blobs: BlobService;

  constructor(db: Db, clock: Clock, blobs: BlobService) {
    this.#db = db;
    this.#clock = clock;
    this.#blobs = blobs;
  }

  /** Sharing a Note again returns its existing Share Link. */
  create(accountId: string, noteId: string): { share: ShareRow; created: boolean } {
    const note = this.#db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.accountId, accountId), eq(notes.id, noteId)))
      .get();
    if (!note) throw new NotFound('No such Note');
    const mine = and(eq(shares.accountId, accountId), eq(shares.noteId, noteId));
    const existing = this.#db.select().from(shares).where(mine).get();
    if (existing) return { share: existing, created: false };
    const share = {
      id: randomUUID(),
      accountId,
      noteId,
      token: newSecret(),
      createdAt: this.#clock().toISOString(),
    };
    this.#db.insert(shares).values(share).run();
    return { share, created: true };
  }

  list(accountId: string): ShareRow[] {
    return this.#db
      .select()
      .from(shares)
      .where(eq(shares.accountId, accountId))
      .orderBy(shares.createdAt)
      .all();
  }

  get(accountId: string, id: string): ShareRow {
    const row = this.#db
      .select()
      .from(shares)
      .where(and(eq(shares.id, id), eq(shares.accountId, accountId)))
      .get();
    if (!row) throw new NotFound('No such Share Link');
    return row;
  }

  revoke(accountId: string, id: string): void {
    const deleted = this.#db
      .delete(shares)
      .where(and(eq(shares.id, id), eq(shares.accountId, accountId)))
      .returning({ id: shares.id })
      .get();
    if (!deleted) throw new NotFound('No such Share Link');
  }

  sharedNote(token: string): NoteRow {
    const note = this.#findShared(token);
    if (!note) throw new NotFound(NOT_SHARED);
    return note;
  }

  /** Only the bytes of the shared Note's own Attachments and their thumbnails. */
  sharedBlob(token: string, id: string): BlobRow {
    const note = this.#findShared(token);
    const listed = note?.attachments?.some((a) => a.id === id || a.thumbnailId === id);
    const row = note && listed ? this.#blobs.find(note.accountId, id) : undefined;
    if (!row) throw new NotFound(NOT_SHARED);
    return row;
  }

  #findShared(token: string): NoteRow | undefined {
    const share = this.#db.select().from(shares).where(eq(shares.token, token)).get();
    if (!share) return undefined;
    const note = this.#db
      .select()
      .from(notes)
      .where(and(eq(notes.accountId, share.accountId), eq(notes.id, share.noteId)))
      .get();
    return note && note.state !== 'trashed' ? note : undefined;
  }
}
