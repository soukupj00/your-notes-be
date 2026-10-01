import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { IsoDateTime, Note, NoteTag, Rev, Tag, TombstoneKind } from '../../contract/index.ts';
import { assertBlobId, SAFE_ID } from '../../store/BlobStore.ts';
import {
  type AllRecords,
  BACKUP_KINDS,
  type BackupKind,
  type BackupRecords,
} from '../../store/records.ts';

// A Server Backup on disk (ADR 0006): manifest.json, one JSON Lines file per kind of record, and
// blobs/<id> for the bytes.

/** Raised whenever what is on disk changes shape; a restore refuses any other. */
export const FORMAT_VERSION = 1;
export const MANIFEST = 'manifest.json';
export const BLOBS = 'blobs';
export const PRIVATE_DIR = 0o700;
export const PRIVATE_FILE = 0o600;

export const Manifest = z.strictObject({
  formatVersion: z.literal(FORMAT_VERSION),
  serverVersion: z.string(),
  createdAt: z.string(),
  counts: z.record(z.enum(BACKUP_KINDS), z.number().int().min(0)),
});
export type Manifest = z.infer<typeof Manifest>;
export type Counts = Manifest['counts'];

const Seq = z.number().int().min(0);
const placed = { accountId: z.string(), seq: Seq };

/**
 * One line of each file: a record with the columns of its table. Synced records also meet the
 * contract, which they met when pushed and must meet for the API to serve them.
 */
const LINES: { [K in BackupKind]: z.ZodType<BackupRecords[K]> } = {
  accounts: z.strictObject({
    id: z.string(),
    username: z.string(),
    passwordHash: z.string().optional(),
    role: z.enum(['owner', 'member']),
    seq: Seq,
    prunedSeq: Seq,
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  sessions: z.strictObject({
    id: z.string(),
    accountId: z.string(),
    tokenHash: z.string(),
    deviceName: z.string(),
    createdAt: z.string(),
    lastSeenAt: z.string(),
    expiresAt: z.string(),
  }),
  notes: z.strictObject({ ...Note.shape, rev: Rev, ...placed }),
  tags: z.strictObject({ ...Tag.shape, rev: Rev, ...placed }),
  noteTags: z.strictObject({ ...NoteTag.shape, rev: Rev, ...placed }),
  tombstones: z.strictObject({
    kind: TombstoneKind,
    id: z.string().min(1),
    deletedAt: IsoDateTime,
    ...placed,
  }),
  // The id names a file, so it is checked before it reaches a path.
  blobRecords: z.strictObject({
    id: z.string().regex(SAFE_ID),
    accountId: z.string(),
    size: z.number().int().min(0),
    mime: z.string(),
    createdAt: z.string(),
  }),
  shares: z.strictObject({
    id: z.string(),
    accountId: z.string(),
    noteId: z.string(),
    token: z.string(),
    createdAt: z.string(),
  }),
};

const fileOf = (kind: BackupKind) => `${kind}.jsonl`;

export function bytesPath(dir: string, id: string): string {
  assertBlobId(id);
  return join(dir, BLOBS, id);
}

/** Writes one JSON object per line into a new file; returns how many. */
export async function writeLines(
  dir: string,
  kind: BackupKind,
  records: AsyncIterable<unknown> | Iterable<unknown>
): Promise<number> {
  let count = 0;
  await pipeline(
    async function* () {
      for await (const record of records) {
        count++;
        yield `${JSON.stringify(record)}\n`;
      }
    },
    createWriteStream(join(dir, fileOf(kind)), { flags: 'wx', mode: PRIVATE_FILE })
  );
  return count;
}

/** The records of one file, each checked against its schema; throws naming the line. */
export async function* readLines<K extends BackupKind>(
  dir: string,
  kind: K
): AsyncIterable<BackupRecords[K]> {
  const file = fileOf(kind);
  const schema = LINES[kind];
  let number = 0;
  for await (const line of createInterface({ input: createReadStream(join(dir, file)) })) {
    number++;
    // Neither message quotes the line, which may hold a password or token hash.
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`${file}, line ${number}: not JSON`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`${file}, line ${number}: ${z.prettifyError(parsed.error)}`);
    }
    yield parsed.data;
  }
}

export function recordsIn(dir: string): AllRecords {
  return Object.fromEntries(
    BACKUP_KINDS.map((kind) => [kind, () => readLines(dir, kind)])
  ) as unknown as AllRecords;
}

/** The manifest, once its format version is known to be this server's. */
export async function readManifest(dir: string): Promise<Manifest> {
  let text: string;
  try {
    text = await readFile(join(dir, MANIFEST), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (existsSync(join(dir, 'younotes.db'))) {
      throw new Error(
        `${dir} is a backup made by an earlier version, a copy of the database file, which ` +
          'restore cannot read; put it back by copying the files (docs/setup.md, section 8)'
      );
    }
    throw new Error(`${dir} has no ${MANIFEST}, so it is not a complete Server Backup`);
  }
  let json: { formatVersion?: unknown; serverVersion?: unknown };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${MANIFEST} in ${dir} is not JSON`);
  }
  if (json.formatVersion !== FORMAT_VERSION) {
    throw new Error(
      `${dir} is in Server Backup format ${String(json.formatVersion)}, made by version ` +
        `${String(json.serverVersion)}; this server reads format ${FORMAT_VERSION} only`
    );
  }
  const parsed = Manifest.safeParse(json);
  if (!parsed.success) throw new Error(`${MANIFEST}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
