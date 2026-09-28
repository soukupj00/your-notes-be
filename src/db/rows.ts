import type {
  Note,
  NoteTag,
  RevisionedNote,
  RevisionedNoteTag,
  RevisionedTag,
  Tag,
  Tombstone,
} from '../contract/index.ts';
import type { notes, noteTags, tags, tombstones } from './schema.ts';

// Between database rows and the contract's shapes: the wire has no `accountId` or `seq`,
// and an absent optional field is SQL null.

type NoteRow = typeof notes.$inferSelect;
type TagRow = typeof tags.$inferSelect;
type NoteTagRow = typeof noteTags.$inferSelect;
type TombstoneRow = typeof tombstones.$inferSelect;

function toWire<T>({
  accountId: _account,
  seq: _seq,
  ...row
}: {
  accountId: string;
  seq: number;
}): T {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as T;
}

export const noteFromRow = (row: NoteRow) => toWire<RevisionedNote>(row);
export const tagFromRow = (row: TagRow) => toWire<RevisionedTag>(row);
export const noteTagFromRow = (row: NoteTagRow) => toWire<RevisionedNoteTag>(row);

export function tombstoneFromRow({ id, kind, deletedAt }: TombstoneRow): Tombstone {
  return { id, kind, deletedAt };
}

export function noteToRow(accountId: string, note: Note, rev: number, seq: number): NoteRow {
  return {
    accountId,
    id: note.id,
    rev,
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

export function tagToRow(accountId: string, tag: Tag, rev: number, seq: number): TagRow {
  return {
    accountId,
    id: tag.id,
    rev,
    seq,
    name: tag.name,
    color: tag.color ?? null,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  };
}

export function noteTagToRow(
  accountId: string,
  link: NoteTag,
  rev: number,
  seq: number
): NoteTagRow {
  return {
    accountId,
    noteId: link.noteId,
    tagId: link.tagId,
    rev,
    seq,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}
