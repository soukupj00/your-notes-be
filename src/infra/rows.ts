import {
  type AllRecords,
  BACKUP_KINDS,
  type BackupKind,
  type StoredNote,
  type StoredNoteTag,
  type StoredTag,
  type TombstoneRecord,
} from '../store/records.ts';
import type { notes, noteTags, tags, tombstones } from './sqlite/schema.ts';

// Between rows and records: a record has no `accountId` or `seq`, and an absent field is SQL null.
// Both schemas give the same rows, so both Stores share these; the PostgreSQL Store compiles only
// while they do.

type NoteRow = typeof notes.$inferSelect;
type TagRow = typeof tags.$inferSelect;
type NoteTagRow = typeof noteTags.$inferSelect;
type TombstoneRow = typeof tombstones.$inferSelect;

/** Drops null fields, so an absent optional field stays absent. */
export function withoutNulls<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as T;
}

function toRecord<T>({
  accountId: _account,
  seq: _seq,
  ...row
}: {
  accountId: string;
  seq: number;
}): T {
  return withoutNulls<T>(row);
}

export const noteFromRow = (row: NoteRow) => toRecord<StoredNote>(row);
export const tagFromRow = (row: TagRow) => toRecord<StoredTag>(row);
export const noteTagFromRow = (row: NoteTagRow) => toRecord<StoredNoteTag>(row);

export function tombstoneFromRow({ id, kind, deletedAt }: TombstoneRow): TombstoneRecord {
  return { id, kind, deletedAt };
}

export function noteToRow(accountId: string, note: StoredNote, seq: number): NoteRow {
  return {
    accountId,
    id: note.id,
    rev: note.rev,
    seq,
    header: note.header ?? null,
    description: note.description ?? null,
    body: note.body ?? null,
    state: note.state,
    pinnedAt: note.pinnedAt ?? null,
    color: note.color ?? null,
    trashedAt: note.trashedAt ?? null,
    remindAt: note.remindAt ?? null,
    repeat: note.repeat ?? null,
    attachments: note.attachments ?? null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export function tagToRow(accountId: string, tag: StoredTag, seq: number): TagRow {
  return {
    accountId,
    id: tag.id,
    rev: tag.rev,
    seq,
    name: tag.name,
    color: tag.color ?? null,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  };
}

export function noteTagToRow(accountId: string, link: StoredNoteTag, seq: number): NoteTagRow {
  return {
    accountId,
    noteId: link.noteId,
    tagId: link.tagId,
    rev: link.rev,
    seq,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

/** Rows per page read and per multi-row insert: well inside both databases' parameter limits. */
export const PAGE = 500;

/**
 * The Server Backup's reading half, for both Stores: every kind of record, each read a page at a
 * time by `page(kind, offset)`; stable only inside one snapshot.
 */
export function recordsOf(
  page: (kind: BackupKind, offset: number) => Promise<object[]> | object[]
): AllRecords {
  return Object.fromEntries(
    BACKUP_KINDS.map((kind) => [kind, () => pages((offset) => page(kind, offset))])
  ) as AllRecords;
}

export async function writeEach(
  records: AllRecords,
  insert: (kind: BackupKind, batch: object[]) => unknown
): Promise<void> {
  for (const kind of BACKUP_KINDS) {
    for await (const batch of batches<object>(records[kind]())) await insert(kind, batch);
  }
}

async function* pages<T>(read: (offset: number) => Promise<T[]> | T[]): AsyncIterable<T> {
  // ponytail: OFFSET paging rescans the skipped rows; keyset paging if a table reaches millions.
  for (let offset = 0; ; offset += PAGE) {
    const rows = await read(offset);
    yield* rows;
    if (rows.length < PAGE) return;
  }
}

async function* batches<T>(records: AsyncIterable<T>): AsyncIterable<T[]> {
  let batch: T[] = [];
  for await (const record of records) {
    batch.push(record);
    if (batch.length === PAGE) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}
