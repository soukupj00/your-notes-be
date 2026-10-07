import type { Note, NoteTag, Tag, Tombstone } from '../contract/index.ts';

// What the Store hands out and takes in: plain values, an absent field is absent, never null.

export type Role = 'owner' | 'member';

export type AccountRecord = { id: string; username: string; role: Role; createdAt: string };

export type NewAccount = AccountRecord & { passwordHash: string };

export type AccountWithPassword = AccountRecord & { passwordHash?: string };

/** One per signed-in Device; the id is the Device's id. */
export type SessionRecord = {
  id: string;
  accountId: string;
  tokenHash: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type CodeKind = 'setup' | 'device' | 'invite';

/** `accountId` is the Account a `device` code joins or the Owner who issued an `invite`. */
export type CodeRecord = {
  codeHash: string;
  kind: CodeKind;
  accountId?: string;
  createdAt: string;
  expiresAt: string;
};

export type SpentCode = { accountId?: string };

/** Synced rows as stored: always with the Revision the server gave them. */
export type StoredNote = Note & { rev: number };
export type StoredTag = Tag & { rev: number };
export type StoredNoteTag = NoteTag & { rev: number };
export type TombstoneRecord = Omit<Tombstone, 'rev'>;

export type Sequenced<T> = { seq: number; record: T };

export type Changes = {
  notes: Sequenced<StoredNote>[];
  tags: Sequenced<StoredTag>[];
  noteTags: Sequenced<StoredNoteTag>[];
  tombstones: Sequenced<TombstoneRecord>[];
};

/** Who owns which bytes, and that they exist (ADR 0003); the bytes are in the BlobStore. */
export type BlobRecord = {
  id: string;
  accountId: string;
  size: number;
  mime: string;
  createdAt: string;
};

export type ShareRecord = {
  id: string;
  accountId: string;
  noteId: string;
  token: string;
  createdAt: string;
};

/** A synced record with the Account it belongs to and the Sequence it was written at. */
type Placed<T> = T & { accountId: string; seq: number };

/**
 * Every record a Server Backup carries, by kind, exactly as stored, so a restore is lossless
 * (ADR 0006). Pairing Codes are left out: they live minutes.
 */
export type BackupRecords = {
  accounts: AccountRecord & {
    passwordHash?: string;
    seq: number;
    prunedSeq: number;
    updatedAt: string;
  };
  sessions: SessionRecord;
  notes: Placed<StoredNote>;
  tags: Placed<StoredTag>;
  noteTags: Placed<StoredNoteTag>;
  tombstones: Placed<TombstoneRecord>;
  blobRecords: BlobRecord;
  shares: ShareRecord;
};

export type BackupKind = keyof BackupRecords;

/** In the order a restore writes them: Accounts before what belongs to them. */
export const BACKUP_KINDS = [
  'accounts',
  'sessions',
  'notes',
  'tags',
  'noteTags',
  'tombstones',
  'blobRecords',
  'shares',
] as const satisfies readonly BackupKind[];

/** Each kind's records, read as they are iterated. */
export type AllRecords = { [K in BackupKind]: () => AsyncIterable<BackupRecords[K]> };

export function mapKinds(
  f: <K extends BackupKind>(kind: K) => () => AsyncIterable<BackupRecords[K]>
): AllRecords {
  return Object.fromEntries(BACKUP_KINDS.map((kind) => [kind, f(kind)])) as AllRecords;
}
