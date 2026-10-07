import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { AttachmentMeta } from '../../contract/index.ts';
import type * as sqlite from '../sqlite/schema.ts';

// The SQLite schema's twin (ADR 0006): the same tables, columns and keys, so both give the same
// rows (rows.ts). Timestamps stay ISO 8601 text, compared as strings.

const account = () =>
  text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' });

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash'),
  role: text('role', { enum: ['owner', 'member'] }).notNull(),
  /** The Account's Sequence (ADR 0002). */
  seq: integer('seq').notNull().default(0),
  /** The highest Sequence of a Tombstone the sweep has removed; older cursors get 410. */
  prunedSeq: integer('pruned_seq').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** One per signed-in Device; the id is the Device's id. */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    accountId: account(),
    tokenHash: text('token_hash').notNull().unique(),
    deviceName: text('device_name').notNull(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('sessions_account_idx').on(t.accountId)]
);

/** Pairing Codes (ADR 0001). */
export const codes = pgTable('codes', {
  codeHash: text('code_hash').primaryKey(),
  kind: text('kind', { enum: ['setup', 'device', 'invite'] }).notNull(),
  /** The Account a `device` code joins, or the Owner who issued an `invite`; null for `setup`. */
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
});

export const notes = pgTable(
  'notes',
  {
    accountId: account(),
    id: text('id').notNull(),
    rev: integer('rev').notNull(),
    seq: integer('seq').notNull(),
    header: text('header'),
    description: text('description'),
    body: text('body'),
    state: text('state', { enum: ['active', 'archived', 'trashed'] }).notNull(),
    pinnedAt: text('pinned_at'),
    color: text('color'),
    trashedAt: text('trashed_at'),
    remindAt: text('remind_at'),
    repeat: text('repeat', { enum: ['daily', 'weekly', 'monthly', 'yearly'] }),
    /** Stored whole, never unpacked (ADR 0003). */
    attachments: jsonb('attachments').$type<AttachmentMeta[]>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.id] }),
    index('notes_account_seq_idx').on(t.accountId, t.seq),
  ]
);

export const tags = pgTable(
  'tags',
  {
    accountId: account(),
    id: text('id').notNull(),
    rev: integer('rev').notNull(),
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.id] }),
    index('tags_account_seq_idx').on(t.accountId, t.seq),
  ]
);

export const noteTags = pgTable(
  'note_tags',
  {
    accountId: account(),
    noteId: text('note_id').notNull(),
    tagId: text('tag_id').notNull(),
    rev: integer('rev').notNull(),
    seq: integer('seq').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.noteId, t.tagId] }),
    index('note_tags_account_seq_idx').on(t.accountId, t.seq),
  ]
);

export const tombstones = pgTable(
  'tombstones',
  {
    accountId: account(),
    kind: text('kind', { enum: ['note', 'tag', 'noteTag'] }).notNull(),
    id: text('id').notNull(),
    seq: integer('seq').notNull(),
    deletedAt: text('deleted_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.kind, t.id] }),
    index('tombstones_account_seq_idx').on(t.accountId, t.seq),
  ]
);

/** Records only; the bytes are in the BlobStore (ADR 0003). */
export const blobs = pgTable(
  'blobs',
  {
    id: text('id').primaryKey(),
    accountId: account(),
    /** 64-bit like SQLite's integer, since BLOB_LIMIT_BYTES may exceed 2 GiB. */
    size: bigint('size', { mode: 'number' }).notNull(),
    mime: text('mime').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('blobs_account_idx').on(t.accountId)]
);

/**
 * Share Links. The token is kept in clear so the link can be shown again (ADR 0005). No key to
 * `notes`: the sweep removes a share whose Note is gone.
 */
export const shares = pgTable(
  'shares',
  {
    id: text('id').primaryKey(),
    accountId: account(),
    noteId: text('note_id').notNull(),
    token: text('token').notNull().unique(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('shares_account_note_idx').on(t.accountId, t.noteId)]
);

// rows.ts is typed by the SQLite schema alone; tsc fails here when a table drifts from its twin.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Agree<T extends true> = T;
export type SchemasAgree = [
  Agree<Same<typeof accounts.$inferSelect, typeof sqlite.accounts.$inferSelect>>,
  Agree<Same<typeof sessions.$inferSelect, typeof sqlite.sessions.$inferSelect>>,
  Agree<Same<typeof codes.$inferSelect, typeof sqlite.codes.$inferSelect>>,
  Agree<Same<typeof notes.$inferSelect, typeof sqlite.notes.$inferSelect>>,
  Agree<Same<typeof tags.$inferSelect, typeof sqlite.tags.$inferSelect>>,
  Agree<Same<typeof noteTags.$inferSelect, typeof sqlite.noteTags.$inferSelect>>,
  Agree<Same<typeof tombstones.$inferSelect, typeof sqlite.tombstones.$inferSelect>>,
  Agree<Same<typeof blobs.$inferSelect, typeof sqlite.blobs.$inferSelect>>,
  Agree<Same<typeof shares.$inferSelect, typeof sqlite.shares.$inferSelect>>,
];
