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
export function revisioned<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) {
  return schema.extend({ rev: Rev.optional() });
}

export const RevisionedNote = revisioned(Note);
export const RevisionedTag = revisioned(Tag);
export const RevisionedNoteTag = revisioned(NoteTag);
export type RevisionedNote = z.infer<typeof RevisionedNote>;
export type RevisionedTag = z.infer<typeof RevisionedTag>;
export type RevisionedNoteTag = z.infer<typeof RevisionedNoteTag>;

export const TombstoneKind = z.enum(['note', 'tag', 'noteTag']);

/** A NoteTag has no id of its own; its Tombstone and push outcome use `<noteId>:<tagId>`. */
export function noteTagId(noteId: string, tagId: string): string {
  return `${noteId}:${tagId}`;
}

/** The two halves of a NoteTag id, or null when `id` is not one. */
export function parseNoteTagId(id: string): { noteId: string; tagId: string } | null {
  const [noteId, tagId, ...rest] = id.split(':');
  if (rest.length > 0 || !Id.safeParse(noteId).success || !Id.safeParse(tagId).success) return null;
  return { noteId: noteId as string, tagId: tagId as string };
}

/**
 * The record that something was purged, so the deletion reaches offline Devices.
 * `id` is the Note's or Tag's id, or `noteTagId(noteId, tagId)` for a NoteTag.
 * `rev` is the Revision the Device last agreed with for what it purged, absent if it never
 * pushed it; a stale one for a Note or Tag answers `conflict`, so a purge never discards a newer edit.
 * The server keeps Tombstones for `TOMBSTONE_DAYS`; a cursor older than that gets 410.
 */
export const Tombstone = z
  .object({
    id: z.string().min(1),
    kind: TombstoneKind,
    deletedAt: IsoDateTime,
    rev: Rev.optional(),
  })
  .refine((t) => t.kind !== 'noteTag' || parseNoteTagId(t.id) !== null, {
    message: 'A noteTag Tombstone id is <noteId>:<tagId>',
    path: ['id'],
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
    /** Present only while the server has no Owner. */
    setup: Link.optional(),
    session: Link,
    devices: Link,
    codes: Link,
    accounts: Link,
    changes: Link,
    stream: Link,
    /** Templated: `{id}` is an Attachment id. */
    blobs: Link,
    shares: Link,
  }),
});
export type RootResponse = z.infer<typeof RootResponse>;

// ---------------------------------------------------------------------------
// Accounts, Sessions and Pairing (ADR 0001)

export const Username = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^\S+$/, { message: 'A username has no spaces' });
export const Password = z.string().min(8).max(256);
export const DeviceName = z.string().trim().min(1).max(64);
/** The secret behind a Pairing Link; the server only says whether it is good, never why not. */
export const PairingCode = z.string().min(1).max(128);
export const Role = z.enum(['owner', 'member']);
export const CodeKind = z.enum(['device', 'invite']);

/** Where a Pairing Link points; the server and the PWA build it the same way. */
export function pairingLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/pair#${code}`;
}

/** Where a Share Link points: the PWA's read-only page for one Note. */
export function shareLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/share/${token}`;
}

export const SetupStatus = z.object({
  needsSetup: z.literal(true),
  _links: z.object({ self: Link }),
});
export type SetupStatus = z.infer<typeof SetupStatus>;

/** Spends the printed setup code (`POST /api/setup`) or an Invite (`POST /api/accounts`). */
export const CreateAccountRequest = z.object({
  code: PairingCode,
  username: Username,
  password: Password,
  deviceName: DeviceName,
});
export type CreateAccountRequest = z.infer<typeof CreateAccountRequest>;

/** Sign in with a password, or with a `device` Pairing Code from an already signed-in Device. */
export const SignInRequest = z.union([
  z.object({ username: Username, password: Password, deviceName: DeviceName }),
  z.object({ code: PairingCode, deviceName: DeviceName }),
]);
export type SignInRequest = z.infer<typeof SignInRequest>;

/** A Local Account as the Owner sees it when managing the household (`GET /api/accounts`). */
export const Account = z.object({
  id: Id,
  username: z.string(),
  role: Role,
  createdAt: IsoDateTime,
  _links: z.object({ self: Link, password: Link }),
});
export type Account = z.infer<typeof Account>;

export const AccountsResponse = z.object({
  _links: z.object({ self: Link }),
  _embedded: z.object({ accounts: z.array(Account) }),
});
export type AccountsResponse = z.infer<typeof AccountsResponse>;

export const SessionResponse = z.object({
  account: z.object({ id: Id, username: z.string(), role: Role }),
  device: z.object({ id: Id, name: z.string() }),
  _links: z.object({
    self: Link,
    devices: Link,
    codes: Link,
    changes: Link,
    blobs: Link,
    shares: Link,
  }),
});
export type SessionResponse = z.infer<typeof SessionResponse>;

export const Device = z.object({
  id: Id,
  name: z.string(),
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
  /** The Device making the request. */
  current: z.boolean(),
  _links: z.object({ self: Link }),
});
export type Device = z.infer<typeof Device>;

export const DevicesResponse = z.object({
  _links: z.object({ self: Link }),
  _embedded: z.object({ devices: z.array(Device) }),
});
export type DevicesResponse = z.infer<typeof DevicesResponse>;

export const CodeRequest = z.object({ kind: CodeKind });
export type CodeRequest = z.infer<typeof CodeRequest>;

export const CodeResponse = z.object({ code: z.string(), kind: CodeKind, expiresAt: IsoDateTime });
export type CodeResponse = z.infer<typeof CodeResponse>;

export const PasswordRequest = z.object({ password: Password });
export type PasswordRequest = z.infer<typeof PasswordRequest>;

// ---------------------------------------------------------------------------
// Share Links: one Note, read-only, for anyone holding the token (ADR 0005)

export const ShareRequest = z.object({ noteId: Id });
export type ShareRequest = z.infer<typeof ShareRequest>;

export const Share = z.object({
  id: Id,
  noteId: Id,
  /** Build the link with `shareLink(origin, token)`. */
  token: z.string(),
  createdAt: IsoDateTime,
  /** `self` revokes it (DELETE); `public` is what anyone with the token reads. */
  _links: z.object({ self: Link, public: Link }),
});
export type Share = z.infer<typeof Share>;

export const SharesResponse = z.object({
  _links: z.object({ self: Link }),
  _embedded: z.object({ shares: z.array(Share) }),
});
export type SharesResponse = z.infer<typeof SharesResponse>;

/** What a Share Link shows: the Note without its Revision; `blobs` is templated by Attachment id. */
export const SharedNote = z.object({
  note: Note,
  _links: z.object({ self: Link, blobs: Link }),
});
export type SharedNote = z.infer<typeof SharedNote>;

// ---------------------------------------------------------------------------
// Sync (PLAN.md "Sync rules"; the frontend's `Remote` seam)

/** Rows in one push, across all four arrays; a bigger batch is 400. */
export const MAX_BATCH = 500;

export const PushBatch = z.object({
  notes: z.array(RevisionedNote).max(MAX_BATCH),
  tags: z.array(RevisionedTag).max(MAX_BATCH),
  noteTags: z.array(RevisionedNoteTag).max(MAX_BATCH),
  tombstones: z.array(Tombstone).max(MAX_BATCH),
});
export type PushBatch = z.infer<typeof PushBatch>;

const RowKind = z.enum(['note', 'tag', 'noteTag']);

/**
 * One per pushed row, in input order: notes, tags, noteTags, tombstones.
 * `id` is the row's id, or `noteTagId(noteId, tagId)` for a NoteTag.
 */
export const PushOutcome = z.discriminatedUnion('status', [
  z.object({ kind: RowKind, id: z.string(), status: z.literal('accepted'), rev: Rev }),
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('note'),
      id: z.string(),
      status: z.literal('conflict'),
      server: RevisionedNote,
    }),
    z.object({
      kind: z.literal('tag'),
      id: z.string(),
      status: z.literal('conflict'),
      server: RevisionedTag,
    }),
  ]),
  z.object({ kind: RowKind, id: z.string(), status: z.literal('gone') }),
]);
export type PushOutcome = z.infer<typeof PushOutcome>;

export const PushResponse = z.object({
  outcomes: z.array(PushOutcome),
  /** The Account's Sequence after this push. */
  seq: z.number().int().min(0),
  _links: z.object({ self: Link, changes: Link }),
});
export type PushResponse = z.infer<typeof PushResponse>;

/**
 * One page of the change feed, ordered by Sequence across the four kinds.
 * `seq` is the Account's current Sequence; without `next` the Device is caught up.
 */
export const ChangesPage = z.object({
  notes: z.array(RevisionedNote),
  tags: z.array(RevisionedTag),
  noteTags: z.array(RevisionedNoteTag),
  tombstones: z.array(Tombstone),
  seq: z.number().int().min(0),
  /** Follow `next` while present; keep `resume` as the cursor for the next sync. */
  _links: z.object({ self: Link, next: Link.optional(), resume: Link, stream: Link }),
});
export type ChangesPage = z.infer<typeof ChangesPage>;

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
