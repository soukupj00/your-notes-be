/**
 * The YouNotes sync contract: the Zod schemas both sides of the wire agree on.
 *
 * This file is vendored verbatim by the frontend (`ni-dip-fe`) and runs in the browser,
 * so it imports nothing but `zod` and nothing from the server.
 * Vendored from ni-dip-be at commit: <unpublished>
 * When copying it, replace the line above with the backend commit it was taken from.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives

/** An instant, as `Date.prototype.toISOString()` writes it. */
export const IsoDateTime = z.iso.datetime({ offset: true });

/** A Reminder's local wall-clock time, deliberately without a zone (frontend ADR 0021). */
export const LocalDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, {
  message: 'Expected local time as YYYY-MM-DDTHH:mm',
});

export const Id = z.uuid();

/** A Revision (frontend ADR 0017): how many accepted changes one thing has had. */
export const Rev = z.number().int().min(1);

// ---------------------------------------------------------------------------
// Entities, mirroring `ni-dip-fe/src/models.ts`

export const NoteState = z.enum(['active', 'archived', 'trashed']);
export const ReminderRepeat = z.enum(['daily', 'weekly', 'monthly', 'yearly']);
export const AttachmentKind = z.enum(['image', 'audio', 'video', 'file', 'excalidraw']);

/**
 * An Attachment without its bytes: it rides on the Note's Revision (frontend ADR 0017)
 * and the server stores it without unpacking it (ADR 0003). Bytes travel through the blob routes.
 */
export const AttachmentMeta = z.object({
  id: Id,
  noteId: Id,
  kind: AttachmentKind,
  mime: z.string().min(1),
  name: z.string().optional(),
  size: z.number().int().min(0).optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
  duration: z.number().min(0).optional(),
  preview: z.string().optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AttachmentMeta = z.infer<typeof AttachmentMeta>;

export const Note = z.object({
  id: Id,
  header: z.string().optional(),
  description: z.string().optional(),
  body: z.string().optional(),
  state: NoteState,
  pinnedAt: IsoDateTime.optional(),
  color: z.string().optional(),
  trashedAt: IsoDateTime.optional(),
  remindAt: LocalDateTime.optional(),
  repeat: ReminderRepeat.optional(),
  attachments: z.array(AttachmentMeta).optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Note = z.infer<typeof Note>;

export const Tag = z.object({
  id: Id,
  name: z.string(),
  color: z.string().optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Tag = z.infer<typeof Tag>;

export const NoteTag = z.object({
  noteId: Id,
  tagId: Id,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type NoteTag = z.infer<typeof NoteTag>;

/** A row plus the Revision it was last in agreement with; absent means never pushed. */
export function revisioned<T extends z.ZodObject>(schema: T) {
  return schema.extend({ rev: Rev.optional() });
}

export const RevisionedNote = revisioned(Note);
export const RevisionedTag = revisioned(Tag);
export const RevisionedNoteTag = revisioned(NoteTag);

export const TombstoneKind = z.enum(['note', 'tag', 'noteTag']);

/** The record that something was purged, so the deletion reaches offline Devices. */
export const Tombstone = z.object({
  id: z.string().min(1),
  kind: TombstoneKind,
  deletedAt: IsoDateTime,
});
export type Tombstone = z.infer<typeof Tombstone>;

// ---------------------------------------------------------------------------
// HAL (https://datatracker.ietf.org/doc/html/draft-kelly-json-hal)

export const Link = z.object({
  href: z.string().min(1),
  templated: z.boolean().optional(),
  title: z.string().optional(),
});
export type Link = z.infer<typeof Link>;

export const Links = z.record(z.string(), Link);
export type Links = z.infer<typeof Links>;

/** The entry point: every route a client needs is reachable from here. */
export const RootResponse = z.object({
  _links: z.object({
    self: Link,
    health: Link,
    docs: Link,
    openapi: Link,
  }),
});
export type RootResponse = z.infer<typeof RootResponse>;

// ---------------------------------------------------------------------------
// Responses

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** RFC 9457 problem details, sent as `application/problem+json` for every error. */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  /** Present on validation failures: where the request was wrong and why. */
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof Problem>;
