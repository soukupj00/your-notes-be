import type {
  AccountRecord,
  AllRecords,
  BlobRecord,
  Changes,
  CodeKind,
  CodeRecord,
  NewAccount,
  SessionRecord,
  ShareRecord,
  SpentCode,
  StoredNote,
  StoredNoteTag,
  StoredTag,
  TombstoneRecord,
} from './records.ts';

// Timestamps are ISO 8601 strings, compared as strings (ADR 0006). "Owned" means scoped to the
// Account, so another Account's row reads as absent.

/**
 * Where records live (ADR 0006): shaped by the domain, every call async. No error it throws quotes
 * a query's values, which hold Note bodies and password and token hashes.
 */
export interface Store extends StoreTx {
  /** A round trip, so `/health` fails when the database does. */
  ping(): Promise<void>;
  /** Waits for calls in flight. */
  close(): Promise<void>;
  /**
   * Runs `fn` against a Store bound to one transaction: commits when it resolves, rolls back and
   * rethrows when it rejects. Inside `fn` only `tx` may be used; the outer Store throws, and so
   * does `tx` once `fn` has ended. Reads see what other transactions committed before each read
   * (PostgreSQL's READ COMMITTED), so work that must not interleave with another request's takes
   * `accounts.lock` first.
   */
  transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T>;
  /** What the Server Backup reads and writes (ADR 0006): every record as stored, whole. */
  serverBackup: {
    /** No Account, and so nothing that belongs to one. */
    isEmpty(): Promise<boolean>;
    /**
     * Runs `fn` over one snapshot of every record, which the server's writes neither change nor
     * wait for. `records` reads only inside `fn`, and the outer Store throws there, as inside
     * `transaction(fn)`.
     */
    read<T>(fn: (records: AllRecords) => Promise<T>): Promise<T>;
    /** Writes every kind in one transaction; throws, writing nothing, unless the Store is empty. */
    write(records: AllRecords): Promise<void>;
  };
}

/** The Store inside a transaction; there is no nesting. */
export interface StoreTx {
  accounts: {
    /** Throws `UsernameTaken` (a `Conflict`) when the username is taken. */
    add(account: NewAccount): Promise<void>;
    /**
     * Holds the Account until the transaction ends: `write` waits for and keeps out every other
     * holder, `read` only writers. A push takes `write` before it reads anything, so two pushes
     * never hand out the same Sequence or both accept an edit of one row; a feed page takes
     * `read`, so every row it reads is at or below the Sequence it reports. Under SQLite the one
     * lock already holds every Account.
     */
    lock(id: string, mode: 'write' | 'read'): Promise<void>;
    find(id: string): Promise<AccountRecord | undefined>;
    findByUsername(
      username: string
    ): Promise<(AccountRecord & { passwordHash?: string }) | undefined>;
    /** Oldest first, ties by id. */
    list(): Promise<AccountRecord[]>;
    owner(): Promise<AccountRecord | undefined>;
    /** False when there is no such Account. */
    setPassword(id: string, passwordHash: string, at: string): Promise<boolean>;
  };
  sessions: {
    add(session: SessionRecord): Promise<void>;
    /** Expired or not; the caller judges. */
    findByTokenHash(
      tokenHash: string
    ): Promise<{ session: SessionRecord; account: AccountRecord } | undefined>;
    touch(id: string, at: string): Promise<void>;
    /** Those not expired at `at`, oldest first, ties by id. */
    listLive(accountId: string, at: string): Promise<SessionRecord[]>;
    remove(id: string): Promise<void>;
    /** False when the Account has no such Session. */
    removeOwned(accountId: string, id: string): Promise<boolean>;
  };
  codes: {
    add(code: CodeRecord): Promise<void>;
    /** Marks a code of this kind used if it is unused and unexpired at `at`. */
    spend(codeHash: string, kind: CodeKind, at: string): Promise<SpentCode | undefined>;
    removeSetupCodes(): Promise<void>;
  };
  sync: {
    /** The Account's Sequence and the highest Sequence the sweep has pruned; 0 for neither. */
    sequence(accountId: string): Promise<{ seq: number; prunedSeq: number }>;
    setSequence(accountId: string, seq: number): Promise<void>;
    note(accountId: string, id: string): Promise<StoredNote | undefined>;
    tag(accountId: string, id: string): Promise<StoredTag | undefined>;
    noteTag(accountId: string, noteId: string, tagId: string): Promise<StoredNoteTag | undefined>;
    isTombstoned(accountId: string, kind: TombstoneRecord['kind'], id: string): Promise<boolean>;
    /** Inserts or replaces. */
    putNote(accountId: string, note: StoredNote, seq: number): Promise<void>;
    putTag(accountId: string, tag: StoredTag, seq: number): Promise<void>;
    putNoteTag(accountId: string, link: StoredNoteTag, seq: number): Promise<void>;
    /** The Note and every link to it. */
    removeNote(accountId: string, id: string): Promise<void>;
    /** The Tag and every link to it. */
    removeTag(accountId: string, id: string): Promise<void>;
    removeNoteTag(accountId: string, noteId: string, tagId: string): Promise<void>;
    addTombstone(accountId: string, tombstone: TombstoneRecord, seq: number): Promise<void>;
    removeTombstone(accountId: string, kind: TombstoneRecord['kind'], id: string): Promise<void>;
    /** Up to `limit` rows of each kind written after `since`, each kind in Sequence order. */
    changesSince(accountId: string, since: number, limit: number): Promise<Changes>;
  };
  blobRecords: {
    /** Does nothing when the id is already recorded. */
    add(blob: BlobRecord): Promise<void>;
    /** Whichever Account owns it. */
    find(id: string): Promise<BlobRecord | undefined>;
    findOwned(accountId: string, id: string): Promise<BlobRecord | undefined>;
    remove(id: string): Promise<void>;
    ids(): Promise<string[]>;
  };
  shares: {
    add(share: ShareRecord): Promise<void>;
    findOwned(accountId: string, id: string): Promise<ShareRecord | undefined>;
    findForNote(accountId: string, noteId: string): Promise<ShareRecord | undefined>;
    /** Oldest first, ties by id. */
    list(accountId: string): Promise<ShareRecord[]>;
    /** False when the Account has no such Share Link. */
    removeOwned(accountId: string, id: string): Promise<boolean>;
    /** The Note a token shares, and its Account, while both the share and the Note exist. */
    sharedNote(token: string): Promise<{ accountId: string; note: StoredNote } | undefined>;
  };
  housekeeping: {
    /** Removes Tombstones deleted before `cutoff`; each Account's pruned Sequence only rises. */
    pruneTombstones(cutoff: string): Promise<void>;
    removeExpiredSessions(at: string): Promise<void>;
    /** Codes spent, or expired at `at`. */
    removeDeadCodes(at: string): Promise<void>;
    /** Share Links whose Note is gone. */
    removeOrphanShares(): Promise<void>;
    /**
     * Blobs recorded before `cutoff` that no Note of their own Account lists, as an Attachment or
     * its thumbnail.
     */
    unreferencedBlobs(cutoff: string): Promise<string[]>;
  };
}
