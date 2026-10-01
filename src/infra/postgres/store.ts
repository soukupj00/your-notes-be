import { and, asc, eq, gt, isNotNull, isNull, lt, lte, max, notExists, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { UsernameTaken } from '../../shared/errors.ts';
import type { Warn } from '../../shared/warn.ts';
import type { Store, StoreTx } from '../../store/Store.ts';
import { guarded } from '../guarded.ts';
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
import { connect, type Db, holdInstanceLock, openPool, scrubbed } from './client.ts';
import { migrateDatabase } from './migrate.ts';
import * as schema from './schema.ts';
import { serverBackupOf } from './serverBackup.ts';

const { accounts, blobs, codes, notes, noteTags, sessions, shares, tags, tombstones } = schema;

export type PostgresOptions = {
  /** Told of every try while the database is not up yet, and of dropped connections. */
  warn: Warn;
  /**
   * For the server, not the CLI: hold the one-instance lock (ADR 0006) for the life of the
   * process, and call `onLost` if its connection drops.
   */
  oneInstance?: { onLost(error: Error): void };
};

/** Waits for the database, takes the one-instance lock if asked, then migrates (ADR 0006). */
export async function openPostgresStore(
  url: string,
  { warn, oneInstance }: PostgresOptions
): Promise<Store> {
  const client = await connect(url, warn);
  client.on('error', (error) => {
    const reason = scrubbed(error.message, url);
    oneInstance?.onLost(new Error(`Lost the connection holding the one-instance lock: ${reason}`));
  });
  try {
    if (oneInstance) await holdInstanceLock(client, url);
    await migrateDatabase(client);
  } catch (error) {
    await client.end();
    throw error;
  }
  if (!oneInstance) await client.end();

  const pool = openPool(url, warn);
  return guarded(
    postgresStore(drizzle(pool, { schema }), async () => {
      await pool.end();
      if (oneInstance) await client.end();
    })
  );
}

const accountColumns = {
  id: accounts.id,
  username: accounts.username,
  role: accounts.role,
  createdAt: accounts.createdAt,
};

type Synced = typeof notes | typeof tags | typeof noteTags | typeof tombstones;
type TombstoneKind = typeof tombstones.$inferSelect.kind;

const first = <T>(rows: T[]): T | undefined => rows[0];

const noteKey = (accountId: string, id: string) =>
  and(eq(notes.accountId, accountId), eq(notes.id, id));
const tagKey = (accountId: string, id: string) =>
  and(eq(tags.accountId, accountId), eq(tags.id, id));
const linkKey = (accountId: string, noteId: string, tagId: string) =>
  and(eq(noteTags.accountId, accountId), eq(noteTags.noteId, noteId), eq(noteTags.tagId, tagId));
const tombstoneKey = (accountId: string, kind: TombstoneKind, id: string) =>
  and(eq(tombstones.accountId, accountId), eq(tombstones.kind, kind), eq(tombstones.id, id));

/** Drizzle wraps the driver's error in its own. */
function violates(error: unknown, constraint: string): boolean {
  const cause = ((error as { cause?: unknown }).cause ?? error) as {
    code?: string;
    constraint?: string;
  };
  return cause.code === '23505' && cause.constraint === constraint;
}

/** Over a pool or PGlite; `end` closes whichever it is. No lock: PostgreSQL isolates. */
export function postgresStore(db: Db, end: () => Promise<void>): Store {
  return {
    ...transactionStore(db),
    async ping() {
      await db.execute(sql`select 1`);
    },
    close: end,
    transaction: (fn) => db.transaction((tx) => fn(transactionStore(tx))),
    serverBackup: serverBackupOf(db),
  };
}

function transactionStore(db: Db): StoreTx {
  return {
    accounts: {
      async add(account) {
        try {
          await db.insert(accounts).values({ ...account, updatedAt: account.createdAt });
        } catch (error) {
          if (violates(error, 'accounts_username_unique')) throw new UsernameTaken();
          throw error;
        }
      },
      async lock(id, mode) {
        // NO KEY UPDATE, not UPDATE: a row referencing the Account (a sign-in, an upload) takes
        // KEY SHARE for its foreign key, and need not wait for a push.
        await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.id, id))
          .for(mode === 'write' ? 'no key update' : 'share');
      },
      async find(id) {
        return first(await db.select(accountColumns).from(accounts).where(eq(accounts.id, id)));
      },
      async findByUsername(username) {
        const row = first(
          await db
            .select({ ...accountColumns, passwordHash: accounts.passwordHash })
            .from(accounts)
            .where(eq(accounts.username, username))
        );
        return row && withoutNulls(row);
      },
      async list() {
        return db.select(accountColumns).from(accounts).orderBy(accounts.createdAt, accounts.id);
      },
      async owner() {
        return first(
          await db.select(accountColumns).from(accounts).where(eq(accounts.role, 'owner'))
        );
      },
      async setPassword(id, passwordHash, at) {
        const updated = await db
          .update(accounts)
          .set({ passwordHash, updatedAt: at })
          .where(eq(accounts.id, id))
          .returning({ id: accounts.id });
        return updated.length > 0;
      },
    },

    sessions: {
      async add(session) {
        await db.insert(sessions).values(session);
      },
      async findByTokenHash(tokenHash) {
        return first(
          await db
            .select({ session: sessions, account: accountColumns })
            .from(sessions)
            .innerJoin(accounts, eq(accounts.id, sessions.accountId))
            .where(eq(sessions.tokenHash, tokenHash))
        );
      },
      async touch(id, at) {
        await db.update(sessions).set({ lastSeenAt: at }).where(eq(sessions.id, id));
      },
      async listLive(accountId, at) {
        return db
          .select()
          .from(sessions)
          .where(and(eq(sessions.accountId, accountId), gt(sessions.expiresAt, at)))
          .orderBy(sessions.createdAt, sessions.id);
      },
      async remove(id) {
        await db.delete(sessions).where(eq(sessions.id, id));
      },
      async removeOwned(accountId, id) {
        const deleted = await db
          .delete(sessions)
          .where(and(eq(sessions.id, id), eq(sessions.accountId, accountId)))
          .returning({ id: sessions.id });
        return deleted.length > 0;
      },
    },

    codes: {
      async add(code) {
        await db.insert(codes).values(code);
      },
      async spend(codeHash, kind, at) {
        const spent = first(
          await db
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
        );
        return spent && withoutNulls(spent);
      },
      async removeSetupCodes() {
        await db.delete(codes).where(eq(codes.kind, 'setup'));
      },
    },

    sync: {
      async sequence(accountId) {
        const row = first(
          await db
            .select({ seq: accounts.seq, prunedSeq: accounts.prunedSeq })
            .from(accounts)
            .where(eq(accounts.id, accountId))
        );
        return row ?? { seq: 0, prunedSeq: 0 };
      },
      async setSequence(accountId, seq) {
        await db.update(accounts).set({ seq }).where(eq(accounts.id, accountId));
      },
      async note(accountId, id) {
        const row = first(await db.select().from(notes).where(noteKey(accountId, id)));
        return row && noteFromRow(row);
      },
      async tag(accountId, id) {
        const row = first(await db.select().from(tags).where(tagKey(accountId, id)));
        return row && tagFromRow(row);
      },
      async noteTag(accountId, noteId, tagId) {
        const row = first(
          await db
            .select()
            .from(noteTags)
            .where(linkKey(accountId, noteId, tagId))
        );
        return row && noteTagFromRow(row);
      },
      async isTombstoned(accountId, kind, id) {
        const rows = await db
          .select({ id: tombstones.id })
          .from(tombstones)
          .where(tombstoneKey(accountId, kind, id));
        return rows.length > 0;
      },
      async putNote(accountId, note, seq) {
        const row = noteToRow(accountId, note, seq);
        await db
          .insert(notes)
          .values(row)
          .onConflictDoUpdate({ target: [notes.accountId, notes.id], set: row });
      },
      async putTag(accountId, tag, seq) {
        const row = tagToRow(accountId, tag, seq);
        await db
          .insert(tags)
          .values(row)
          .onConflictDoUpdate({ target: [tags.accountId, tags.id], set: row });
      },
      async putNoteTag(accountId, link, seq) {
        const row = noteTagToRow(accountId, link, seq);
        await db
          .insert(noteTags)
          .values(row)
          .onConflictDoUpdate({
            target: [noteTags.accountId, noteTags.noteId, noteTags.tagId],
            set: row,
          });
      },
      async removeNote(accountId, id) {
        await db.delete(notes).where(noteKey(accountId, id));
        await db
          .delete(noteTags)
          .where(and(eq(noteTags.accountId, accountId), eq(noteTags.noteId, id)));
      },
      async removeTag(accountId, id) {
        await db.delete(tags).where(tagKey(accountId, id));
        await db
          .delete(noteTags)
          .where(and(eq(noteTags.accountId, accountId), eq(noteTags.tagId, id)));
      },
      async removeNoteTag(accountId, noteId, tagId) {
        await db.delete(noteTags).where(linkKey(accountId, noteId, tagId));
      },
      async addTombstone(accountId, { kind, id, deletedAt }, seq) {
        await db.insert(tombstones).values({ accountId, kind, id, seq, deletedAt });
      },
      async removeTombstone(accountId, kind, id) {
        await db.delete(tombstones).where(tombstoneKey(accountId, kind, id));
      },
      async changesSince(accountId, since, limit) {
        const after = (table: Synced) => and(eq(table.accountId, accountId), gt(table.seq, since));
        const noteRows = await db
          .select()
          .from(notes)
          .where(after(notes))
          .orderBy(asc(notes.seq))
          .limit(limit);
        const tagRows = await db
          .select()
          .from(tags)
          .where(after(tags))
          .orderBy(asc(tags.seq))
          .limit(limit);
        const linkRows = await db
          .select()
          .from(noteTags)
          .where(after(noteTags))
          .orderBy(asc(noteTags.seq))
          .limit(limit);
        const tombstoneRows = await db
          .select()
          .from(tombstones)
          .where(after(tombstones))
          .orderBy(asc(tombstones.seq))
          .limit(limit);
        return {
          notes: noteRows.map((row) => ({ seq: row.seq, record: noteFromRow(row) })),
          tags: tagRows.map((row) => ({ seq: row.seq, record: tagFromRow(row) })),
          noteTags: linkRows.map((row) => ({ seq: row.seq, record: noteTagFromRow(row) })),
          tombstones: tombstoneRows.map((row) => ({ seq: row.seq, record: tombstoneFromRow(row) })),
        };
      },
    },

    blobRecords: {
      async add(blob) {
        await db.insert(blobs).values(blob).onConflictDoNothing();
      },
      async find(id) {
        return first(await db.select().from(blobs).where(eq(blobs.id, id)));
      },
      async findOwned(accountId, id) {
        return first(
          await db
            .select()
            .from(blobs)
            .where(and(eq(blobs.id, id), eq(blobs.accountId, accountId)))
        );
      },
      async remove(id) {
        await db.delete(blobs).where(eq(blobs.id, id));
      },
      async ids() {
        const rows = await db.select({ id: blobs.id }).from(blobs);
        return rows.map((row) => row.id);
      },
    },

    shares: {
      async add(share) {
        await db.insert(shares).values(share);
      },
      async findOwned(accountId, id) {
        return first(
          await db
            .select()
            .from(shares)
            .where(and(eq(shares.id, id), eq(shares.accountId, accountId)))
        );
      },
      async findForNote(accountId, noteId) {
        return first(
          await db
            .select()
            .from(shares)
            .where(and(eq(shares.accountId, accountId), eq(shares.noteId, noteId)))
        );
      },
      async list(accountId) {
        return db
          .select()
          .from(shares)
          .where(eq(shares.accountId, accountId))
          .orderBy(shares.createdAt, shares.id);
      },
      async removeOwned(accountId, id) {
        const deleted = await db
          .delete(shares)
          .where(and(eq(shares.id, id), eq(shares.accountId, accountId)))
          .returning({ id: shares.id });
        return deleted.length > 0;
      },
      async sharedNote(token) {
        const row = first(
          await db
            .select({ note: notes })
            .from(shares)
            .innerJoin(
              notes,
              and(eq(notes.accountId, shares.accountId), eq(notes.id, shares.noteId))
            )
            .where(eq(shares.token, token))
        );
        return row && { accountId: row.note.accountId, note: noteFromRow(row.note) };
      },
    },

    housekeeping: {
      async pruneTombstones(cutoff) {
        const old = lt(tombstones.deletedAt, cutoff);
        const removed = await db
          .select({ accountId: tombstones.accountId, seq: max(tombstones.seq) })
          .from(tombstones)
          .where(old)
          .groupBy(tombstones.accountId);
        for (const { accountId, seq } of removed) {
          if (seq === null) continue;
          // PostgreSQL's greatest; SQLite spells it as a two-argument max (ADR 0006).
          await db
            .update(accounts)
            .set({ prunedSeq: sql`greatest(${accounts.prunedSeq}, ${seq})` })
            .where(eq(accounts.id, accountId));
        }
        await db.delete(tombstones).where(old);
      },
      async removeExpiredSessions(at) {
        await db.delete(sessions).where(lte(sessions.expiresAt, at));
      },
      async removeDeadCodes(at) {
        await db.delete(codes).where(or(isNotNull(codes.usedAt), lte(codes.expiresAt, at)));
      },
      async removeOrphanShares() {
        const note = db
          .select({ one: sql`1` })
          .from(notes)
          .where(and(eq(notes.accountId, shares.accountId), eq(notes.id, shares.noteId)));
        await db.delete(shares).where(notExists(note));
      },
      async unreferencedBlobs(cutoff) {
        // Attachments are a JSON column (ADR 0003), unpacked here with jsonb_array_elements.
        const rows = await db
          .select({ id: blobs.id })
          .from(blobs)
          .where(
            and(
              lt(blobs.createdAt, cutoff),
              sql`not exists (
                select 1 from ${notes} n, jsonb_array_elements(n.attachments) a
                where n.account_id = ${blobs.accountId}
                  and ${blobs.id} in (a->>'id', a->>'thumbnailId'))`
            )
          );
        return rows.map((row) => row.id);
      },
    },
  };
}
