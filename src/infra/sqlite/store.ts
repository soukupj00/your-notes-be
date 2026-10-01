import { and, asc, eq, gt, isNotNull, isNull, lt, lte, max, or, sql } from 'drizzle-orm';
import { UsernameTaken } from '../../shared/errors.ts';
import type { Store, StoreTx } from '../../store/Store.ts';
import {
  noteFromRow,
  noteTagFromRow,
  noteTagToRow,
  noteToRow,
  tagFromRow,
  tagToRow,
  tombstoneFromRow,
  withoutNulls,
} from '../rows.ts';
import { type Db, openDatabase } from './client.ts';
import { locked } from './lock.ts';
import { migrateDatabase } from './migrate.ts';
import {
  accounts,
  blobs,
  codes,
  notes,
  noteTags,
  sessions,
  shares,
  tags,
  tombstones,
} from './schema.ts';
import { serverBackupOf } from './serverBackup.ts';

/** Opens the database file, or `:memory:`, migrated and behind the lock (ADR 0006). */
export function openSqliteStore(path: string): Store {
  const db = openDatabase(path);
  migrateDatabase(db);
  return locked(unlockedStore(db));
}

const accountColumns = {
  id: accounts.id,
  username: accounts.username,
  role: accounts.role,
  createdAt: accounts.createdAt,
};

type Synced = typeof notes | typeof tags | typeof noteTags | typeof tombstones;
type TombstoneKind = typeof tombstones.$inferSelect.kind;

const noteKey = (accountId: string, id: string) =>
  and(eq(notes.accountId, accountId), eq(notes.id, id));
const tagKey = (accountId: string, id: string) =>
  and(eq(tags.accountId, accountId), eq(tags.id, id));
const linkKey = (accountId: string, noteId: string, tagId: string) =>
  and(eq(noteTags.accountId, accountId), eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId));
const tombstoneKey = (accountId: string, kind: TombstoneKind, id: string) =>
  and(eq(tombstones.accountId, accountId), eq(tombstones.kind, kind), eq(tombstones.id, id));

/** Correct only one call at a time: every call and transaction shares the one connection. */
function unlockedStore(db: Db): Store {
  const tx: StoreTx = {
    accounts: {
      async add(account) {
        try {
          db.insert(accounts)
            .values({ ...account, updatedAt: account.createdAt })
            .run();
        } catch (error) {
          if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
            throw new UsernameTaken();
          }
          throw error;
        }
      },
      // The one lock already holds every Account.
      async lock() {},
      async find(id) {
        return db.select(accountColumns).from(accounts).where(eq(accounts.id, id)).get();
      },
      async findByUsername(username) {
        const row = db
          .select({ ...accountColumns, passwordHash: accounts.passwordHash })
          .from(accounts)
          .where(eq(accounts.username, username))
          .get();
        return row && withoutNulls(row);
      },
      async list() {
        return db
          .select(accountColumns)
          .from(accounts)
          .orderBy(accounts.createdAt, accounts.id)
          .all();
      },
      async owner() {
        return db.select(accountColumns).from(accounts).where(eq(accounts.role, 'owner')).get();
      },
      async setPassword(id, passwordHash, at) {
        const updated = db
          .update(accounts)
          .set({ passwordHash, updatedAt: at })
          .where(eq(accounts.id, id))
          .returning({ id: accounts.id })
          .get();
        return updated !== undefined;
      },
    },

    sessions: {
      async add(session) {
        db.insert(sessions).values(session).run();
      },
      async findByTokenHash(tokenHash) {
        return db
          .select({ session: sessions, account: accountColumns })
          .from(sessions)
          .innerJoin(accounts, eq(accounts.id, sessions.accountId))
          .where(eq(sessions.tokenHash, tokenHash))
          .get();
      },
      async touch(id, at) {
        db.update(sessions).set({ lastSeenAt: at }).where(eq(sessions.id, id)).run();
      },
      async listLive(accountId, at) {
        return db
          .select()
          .from(sessions)
          .where(and(eq(sessions.accountId, accountId), gt(sessions.expiresAt, at)))
          .orderBy(sessions.createdAt, sessions.id)
          .all();
      },
      async remove(id) {
        db.delete(sessions).where(eq(sessions.id, id)).run();
      },
      async removeOwned(accountId, id) {
        const deleted = db
          .delete(sessions)
          .where(and(eq(sessions.id, id), eq(sessions.accountId, accountId)))
          .returning({ id: sessions.id })
          .get();
        return deleted !== undefined;
      },
    },

    codes: {
      async add(code) {
        db.insert(codes).values(code).run();
      },
      async spend(codeHash, kind, at) {
        const spent = db
          .update(codes)
          .set({ usedAt: at })
          .where(
            and(
              eq(codes.codeHash, codeHash),
              eq(codes.kind, kind),
              isNull(codes.usedAt),
              gt(codes.expiresAt, at)
            )
          )
          .returning({ accountId: codes.accountId })
          .get();
        return spent && withoutNulls(spent);
      },
      async removeSetupCodes() {
        db.delete(codes).where(eq(codes.kind, 'setup')).run();
      },
    },

    sync: {
      async sequence(accountId) {
        const row = db
          .select({ seq: accounts.seq, prunedSeq: accounts.prunedSeq })
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .get();
        return row ?? { seq: 0, prunedSeq: 0 };
      },
      async setSequence(accountId, seq) {
        db.update(accounts).set({ seq }).where(eq(accounts.id, accountId)).run();
      },
      async note(accountId, id) {
        const row = db.select().from(notes).where(noteKey(accountId, id)).get();
        return row && noteFromRow(row);
      },
      async tag(accountId, id) {
        const row = db.select().from(tags).where(tagKey(accountId, id)).get();
        return row && tagFromRow(row);
      },
      async noteTag(accountId, noteId, tagId) {
        const row = db
          .select()
          .from(noteTags)
          .where(linkKey(accountId, noteId, tagId))
          .get();
        return row && noteTagFromRow(row);
      },
      async isTombstoned(accountId, kind, id) {
        const row = db
          .select({ id: tombstones.id })
          .from(tombstones)
          .where(tombstoneKey(accountId, kind, id))
          .get();
        return row !== undefined;
      },
      async putNote(accountId, note, seq) {
        const row = noteToRow(accountId, note, seq);
        db.insert(notes)
          .values(row)
          .onConflictDoUpdate({ target: [notes.accountId, notes.id], set: row })
          .run();
      },
      async putTag(accountId, tag, seq) {
        const row = tagToRow(accountId, tag, seq);
        db.insert(tags)
          .values(row)
          .onConflictDoUpdate({ target: [tags.accountId, tags.id], set: row })
          .run();
      },
      async putNoteTag(accountId, link, seq) {
        const row = noteTagToRow(accountId, link, seq);
        db.insert(noteTags)
          .values(row)
          .onConflictDoUpdate({
            target: [noteTags.accountId, noteTags.noteId, noteTags.tagId],
            set: row,
          })
          .run();
      },
      async removeNote(accountId, id) {
        db.delete(notes).where(noteKey(accountId, id)).run();
        db.delete(noteTags)
          .where(and(eq(noteTags.accountId, accountId), eq(noteTags.noteId, id)))
          .run();
      },
      async removeTag(accountId, id) {
        db.delete(tags).where(tagKey(accountId, id)).run();
        db.delete(noteTags)
          .where(and(eq(noteTags.accountId, accountId), eq(noteTags.tagId, id)))
          .run();
      },
      async removeNoteTag(accountId, noteId, tagId) {
        db.delete(noteTags)
          .where(linkKey(accountId, noteId, tagId))
          .run();
      },
      async addTombstone(accountId, { kind, id, deletedAt }, seq) {
        db.insert(tombstones).values({ accountId, kind, id, seq, deletedAt }).run();
      },
      async removeTombstone(accountId, kind, id) {
        db.delete(tombstones)
          .where(tombstoneKey(accountId, kind, id))
          .run();
      },
      async changesSince(accountId, since, limit) {
        const after = (table: Synced) => and(eq(table.accountId, accountId), gt(table.seq, since));
        const read = <T extends Synced>(table: T) =>
          db.select().from(table).where(after(table)).orderBy(asc(table.seq)).limit(limit);
        return {
          notes: read(notes)
            .all()
            .map((row) => ({ seq: row.seq, record: noteFromRow(row) })),
          tags: read(tags)
            .all()
            .map((row) => ({ seq: row.seq, record: tagFromRow(row) })),
          noteTags: read(noteTags)
            .all()
            .map((row) => ({ seq: row.seq, record: noteTagFromRow(row) })),
          tombstones: read(tombstones)
            .all()
            .map((row) => ({ seq: row.seq, record: tombstoneFromRow(row) })),
        };
      },
    },

    blobRecords: {
      async add(blob) {
        db.insert(blobs).values(blob).onConflictDoNothing().run();
      },
      async find(id) {
        return db.select().from(blobs).where(eq(blobs.id, id)).get();
      },
      async findOwned(accountId, id) {
        return db
          .select()
          .from(blobs)
          .where(and(eq(blobs.id, id), eq(blobs.accountId, accountId)))
          .get();
      },
      async remove(id) {
        db.delete(blobs).where(eq(blobs.id, id)).run();
      },
      async ids() {
        return db
          .select({ id: blobs.id })
          .from(blobs)
          .all()
          .map((row) => row.id);
      },
    },

    shares: {
      async add(share) {
        db.insert(shares).values(share).run();
      },
      async findOwned(accountId, id) {
        return db
          .select()
          .from(shares)
          .where(and(eq(shares.id, id), eq(shares.accountId, accountId)))
          .get();
      },
      async findForNote(accountId, noteId) {
        return db
          .select()
          .from(shares)
          .where(and(eq(shares.accountId, accountId), eq(shares.noteId, noteId)))
          .get();
      },
      async list(accountId) {
        return db
          .select()
          .from(shares)
          .where(eq(shares.accountId, accountId))
          .orderBy(shares.createdAt, shares.id)
          .all();
      },
      async removeOwned(accountId, id) {
        const deleted = db
          .delete(shares)
          .where(and(eq(shares.id, id), eq(shares.accountId, accountId)))
          .returning({ id: shares.id })
          .get();
        return deleted !== undefined;
      },
      async sharedNote(token) {
        const row = db
          .select({ note: notes })
          .from(shares)
          .innerJoin(notes, and(eq(notes.accountId, shares.accountId), eq(notes.id, shares.noteId)))
          .where(eq(shares.token, token))
          .get();
        return row && { accountId: row.note.accountId, note: noteFromRow(row.note) };
      },
    },

    housekeeping: {
      async pruneTombstones(cutoff) {
        const old = lt(tombstones.deletedAt, cutoff);
        const removed = db
          .select({ accountId: tombstones.accountId, seq: max(tombstones.seq) })
          .from(tombstones)
          .where(old)
          .groupBy(tombstones.accountId)
          .all();
        for (const { accountId, seq } of removed) {
          if (seq === null) continue;
          // SQLite's two-argument max; another database spells it its own way (ADR 0006).
          db.update(accounts)
            .set({ prunedSeq: sql`max(${accounts.prunedSeq}, ${seq})` })
            .where(eq(accounts.id, accountId))
            .run();
        }
        db.delete(tombstones).where(old).run();
      },
      async removeExpiredSessions(at) {
        db.delete(sessions).where(lte(sessions.expiresAt, at)).run();
      },
      async removeDeadCodes(at) {
        db.delete(codes)
          .where(or(isNotNull(codes.usedAt), lte(codes.expiresAt, at)))
          .run();
      },
      async removeOrphanShares() {
        db.run(sql`
          delete from ${shares} where not exists (
            select 1 from ${notes} n
            where n.account_id = ${shares.accountId} and n.id = ${shares.noteId}
          )`);
      },
      async unreferencedBlobs(cutoff) {
        // Attachments are a JSON column (ADR 0003), unpacked here with SQLite's json_each.
        const rows = db.all<{ id: string }>(sql`
          select b.id from ${blobs} b
          where b.created_at < ${cutoff}
            and not exists (
              select 1 from notes n, json_each(n.attachments) a
              where n.account_id = b.account_id
                and b.id in (json_extract(a.value, '$.id'), json_extract(a.value, '$.thumbnailId'))
            )`);
        return rows.map((row) => row.id);
      },
    },
  };

  return {
    ...tx,
    serverBackup: serverBackupOf(db),
    async ping() {
      db.$client.prepare('select 1').get();
    },
    async close() {
      db.$client.close();
    },
    async transaction(fn) {
      // IMMEDIATE: a database busy in another process waits at BEGIN, not fails mid-transaction.
      db.$client.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(tx);
        db.$client.exec('COMMIT');
        return result;
      } catch (error) {
        if (db.$client.inTransaction) db.$client.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
