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
    /** Present only while the server has no Owner. */
    setup: Link.optional(),
    session: Link,
    devices: Link,
    codes: Link,
    accounts: Link,
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

export const SessionResponse = z.object({
  account: z.object({ id: Id, username: z.string(), role: Role }),
  device: z.object({ id: Id, name: z.string() }),
  _links: z.object({ self: Link, devices: Link, codes: Link }),
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
