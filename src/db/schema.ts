import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { AttachmentMeta } from '../contract/index.ts';

// Ids are text UUIDs; timestamps are ISO 8601 strings, the same as on the wire.
// Synced rows are keyed by (account, id) so one Account can never collide with another's ids.

const account = () =>
  text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' });

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash'),
  role: text('role', { enum: ['owner', 'member'] }).notNull(),
  /** The Account's Sequence: advanced by every accepted change (ADR 0002). */
  seq: integer('seq').notNull().default(0),
  /** The highest Sequence of a Tombstone the sweep has removed; older cursors get 410. */
  prunedSeq: integer('pruned_seq').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** One row per signed-in Device; the id is the Device's id. */
export const sessions = sqliteTable(
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

/** Pairing Codes (ADR 0001): hashed, single use, short-lived. */
export const codes = sqliteTable('codes', {
  codeHash: text('code_hash').primaryKey(),
  kind: text('kind', { enum: ['setup', 'device', 'invite'] }).notNull(),
  /** The Account a `device` code joins, or the Owner who issued an `invite`; null for `setup`. */
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
});

export const notes = sqliteTable(
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
    attachments: text('attachments', { mode: 'json' }).$type<AttachmentMeta[]>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.id] }),
    index('notes_account_seq_idx').on(t.accountId, t.seq),
  ]
);

export const tags = sqliteTable(
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

export const noteTags = sqliteTable(
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

export const tombstones = sqliteTable(
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

/** Which Account owns which bytes, and that they exist (ADR 0003); the bytes are in the BlobStore. */
export const blobs = sqliteTable(
  'blobs',
  {
    id: text('id').primaryKey(),
    accountId: account(),
    size: integer('size').notNull(),
    /** The Content-Type it was uploaded with, served back as is. */
    mime: text('mime').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('blobs_account_idx').on(t.accountId)]
);

/**
 * Share Links: one per shared Note, readable by anyone holding the token. The token is kept in
 * clear so the link can be shown again (ADR 0005); the sweep removes a share whose Note is gone.
 */
export const shares = sqliteTable(
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
