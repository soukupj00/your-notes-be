import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.ts';
import { ChangesPage, type PushBatch, PushResponse, Share } from '../contract/index.ts';
import { diskBlobStore } from '../infra/blobs/disk.ts';
import { memoryBlobStore } from '../infra/blobs/memory.ts';
import { s3BlobStore } from '../infra/blobs/s3.ts';
import { s3TestEndpoint, s3TestSettings } from '../infra/blobs/testing.ts';
import { pgliteTestStore } from '../infra/postgres/testing.ts';
import { openSqliteStore } from '../infra/sqlite/store.ts';
import { type Server, ServerBackupService } from '../modules/backup/service.ts';
import { type App, buildServer } from '../server.ts';
import type { BlobStore } from '../store/BlobStore.ts';
import { BACKUP_KINDS } from '../store/records.ts';
import type { Store } from '../store/Store.ts';
import { VERSION } from '../version.ts';
import { as, signUpOwner, testStore } from './helpers.ts';

const T = '2026-09-28T10:00:00.000Z';
const BYTES = Buffer.from('a picture, byte for byte');

const stores: Store[] = [];

/** The other database than `testStore()`, so each Vitest project crosses from one to the other. */
async function otherStore(): Promise<Store> {
  const store =
    process.env.TEST_STORE === 'pglite' ? openSqliteStore(':memory:') : await pgliteTestStore();
  stores.push(store);
  return store;
}

let root: string;
let source: Server;
const apps: App[] = [];
const warn = vi.fn();

// Both projects use this file's PGlite, as testStore() or as otherStore(); booted before the
// first test, as in pglite.setup.ts.
beforeAll(async () => {
  await pgliteTestStore();
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'younotes-server-backup-'));
  source = { store: await testStore(), blobs: await diskBlobStore(join(root, 'blobs')) };
  warn.mockClear();
});

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const store of [source.store, ...stores.splice(0)]) await store.close();
  await rm(root, { recursive: true, force: true });
});

const service = (server: Server) => new ServerBackupService(server, () => new Date(T), warn);

async function serve({ store, blobs }: Server): Promise<App> {
  const config = loadConfig({ PUBLIC_DIR: '/nonexistent' });
  const app = await buildServer({ config, store, blobs, logger: false });
  apps.push(app);
  return app;
}

async function push(app: App, cookie: string, batch: Partial<PushBatch>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/changes',
    payload: { notes: [], tags: [], noteTags: [], tombstones: [], ...batch },
    ...as(cookie),
  });
  expect(response.statusCode, response.body).toBe(200);
  return PushResponse.parse(response.json());
}

async function pull(app: App, cookie: string, since: number) {
  const response = await app.inject({ url: `/api/changes?since=${since}`, ...as(cookie) });
  expect(response.statusCode, response.body).toBe(200);
  return ChangesPage.parse(response.json());
}

const bare = (id: string) => ({ id, state: 'active' as const, createdAt: T, updatedAt: T });

type Device = { cookie: string; cursor: number; picture: string; token: string };

/**
 * Through the API, as a Device uses the source: the Owner, a Note with a picture and a Tag, a
 * deleted Note, a Share Link, then a pull whose cursor it keeps.
 */
async function useSource(): Promise<Device> {
  const app = await serve(source);
  const cookie = await signUpOwner(app);
  const [noteId, picture, tagId, doomed] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const attachment = {
    id: picture,
    noteId,
    kind: 'image' as const,
    mime: 'image/png',
    createdAt: T,
    updatedAt: T,
  };
  await push(app, cookie, {
    notes: [{ ...bare(noteId), body: '<p>Shopping</p>', attachments: [attachment] }, bare(doomed)],
    tags: [{ id: tagId, name: 'Home', createdAt: T, updatedAt: T }],
    noteTags: [{ noteId, tagId, createdAt: T, updatedAt: T }],
  });
  await push(app, cookie, { tombstones: [{ kind: 'note', id: doomed, deletedAt: T, rev: 1 }] });
  const upload = await app.inject({
    method: 'PUT',
    url: `/api/blobs/${picture}`,
    payload: BYTES,
    headers: { 'content-type': 'image/png' },
    ...as(cookie),
  });
  expect(upload.statusCode).toBe(201);
  const shared = await app.inject({
    method: 'POST',
    url: '/api/shares',
    payload: { noteId },
    ...as(cookie),
  });
  const { token } = Share.parse(shared.json());
  return { cookie, cursor: (await pull(app, cookie, 0)).seq, picture, token };
}

/** Every record, read the way a backup reads them. */
function everything(store: Store) {
  return store.serverBackup.read(async (records) => {
    const all: Record<string, unknown[]> = {};
    for (const kind of BACKUP_KINDS) {
      all[kind] = [];
      for await (const record of records[kind]()) all[kind].push(record);
    }
    return all;
  });
}

/**
 * On a server over `target`, the Device is still signed in, finds nothing new from its cursor,
 * reads its picture and its Share Link, and its next push takes the next Sequence.
 */
async function expectCarriesOn(target: Server, device: Device) {
  const app = await serve(target);
  expect((await app.inject({ url: '/api/session', ...as(device.cookie) })).statusCode).toBe(200);
  expect(await pull(app, device.cookie, device.cursor)).toMatchObject({
    seq: device.cursor,
    notes: [],
    tags: [],
    noteTags: [],
    tombstones: [],
  });
  const bytes = await app.inject({ url: `/api/blobs/${device.picture}`, ...as(device.cookie) });
  expect(bytes.rawPayload).toEqual(BYTES);
  expect((await app.inject({ url: `/api/public/shares/${device.token}` })).statusCode).toBe(200);
  const { seq } = await push(app, device.cookie, { notes: [bare(randomUUID())] });
  expect(seq).toBe(device.cursor + 1);
}

const isEmpty = async ({ store, blobs }: Server) =>
  (await store.serverBackup.isEmpty()) && (await blobs.list()).length === 0;

describe('backup and restore', () => {
  it('copy every record and byte, and Devices carry on signed in, without a resync', async () => {
    const device = await useSource();
    const dir = join(root, 'backup');

    const manifest = await service(source).backup(dir);
    expect(manifest).toEqual({
      formatVersion: 1,
      serverVersion: VERSION,
      createdAt: T,
      counts: Object.fromEntries(BACKUP_KINDS.map((kind) => [kind, 1])),
    });
    expect((await readdir(dir)).sort()).toEqual(
      ['blobs', 'manifest.json', ...BACKUP_KINDS.map((kind) => `${kind}.jsonl`)].sort()
    );
    expect(await readdir(join(dir, 'blobs'))).toEqual([device.picture]);

    const target = { store: await otherStore(), blobs: memoryBlobStore() };
    expect(await service(target).restore(dir)).toEqual(manifest);
    expect(await everything(target.store)).toEqual(await everything(source.store));
    await expectCarriesOn(target, device);
  });

  it('let only their owner read a backup, which holds Share Link tokens', async () => {
    await useSource();
    const dir = join(root, 'backup');
    await service(source).backup(dir);

    const paths = [dir, join(dir, 'blobs')];
    for (const name of await readdir(dir)) paths.push(join(dir, name));
    for (const name of await readdir(join(dir, 'blobs'))) paths.push(join(dir, 'blobs', name));
    for (const path of paths) {
      expect(((await stat(path)).mode & 0o077).toString(8), path).toBe('0');
    }
  });

  it('leave out, with a warning, a blob whose bytes are gone', async () => {
    const device = await useSource();
    const owner = (await source.store.accounts.owner())!;
    const lost = randomUUID();
    await source.store.blobRecords.add({
      id: lost,
      accountId: owner.id,
      size: 3,
      mime: 'image/png',
      createdAt: T,
    });
    const dir = join(root, 'backup');

    expect((await service(source).backup(dir)).counts.blobRecords).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(lost));

    const target = { store: await otherStore(), blobs: memoryBlobStore() };
    await service(target).restore(dir);
    expect(await target.store.blobRecords.ids()).toEqual([device.picture]);
  });

  it('back up only into an empty directory', async () => {
    await mkdir(join(root, 'backup'));
    await writeFile(join(root, 'backup', 'note.txt'), 'mine');
    await expect(service(source).backup(join(root, 'backup'))).rejects.toThrow(/not empty/);
  });

  it('restore only into an empty Store and BlobStore', async () => {
    await useSource();
    const dir = join(root, 'backup');
    await service(source).backup(dir);

    await expect(service(source).restore(dir)).rejects.toThrow(/database to fill/);
    const blobs = memoryBlobStore();
    await blobs.put('x', BYTES, BYTES.length);
    const target = { store: await otherStore(), blobs };
    await expect(service(target).restore(dir)).rejects.toThrow(/Attachment storage to fill/);
    expect(await target.store.serverBackup.isEmpty()).toBe(true);
  });

  it('restore refuses a backup it cannot read, naming why', async () => {
    const target = { store: await otherStore(), blobs: memoryBlobStore() };
    const dir = join(root, 'backup');
    await mkdir(dir);
    await expect(service(target).restore(dir)).rejects.toThrow(/no manifest\.json/);

    await writeFile(join(dir, 'younotes.db'), '');
    await expect(service(target).restore(dir)).rejects.toThrow(
      /earlier version.*copying the files/
    );

    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({ formatVersion: 2, serverVersion: '9.0.0' })
    );
    await expect(service(target).restore(dir)).rejects.toThrow(/format 2, made by version 9\.0\.0/);
  });

  it('restore checks every line and every file first, and writes nothing from a damaged backup', async () => {
    await useSource();
    const dir = join(root, 'backup');
    await service(source).backup(dir);
    const target = { store: await otherStore(), blobs: memoryBlobStore() };
    const damage = async (file: string, text: string, check: RegExp) => {
      const original = await readFile(join(dir, file));
      await writeFile(join(dir, file), text);
      const failing = service(target).restore(dir);
      await expect(failing).rejects.toThrow(check);
      await expect(failing).rejects.not.toThrow(/secret/);
      await writeFile(join(dir, file), original);
      expect(await isEmpty(target)).toBe(true);
    };

    await damage('sessions.jsonl', 'not json, secret\n', /sessions\.jsonl, line 1: not JSON/);
    const session = JSON.parse(await readFile(join(dir, 'sessions.jsonl'), 'utf8'));
    await damage(
      'sessions.jsonl',
      `${JSON.stringify({ ...session, tokenHash: 7, extra: 'secret' })}\n`,
      /sessions\.jsonl, line 1:.*tokenHash/s
    );
    await damage('tags.jsonl', '', /tags\.jsonl holds 0 records; manifest\.json says 1/);
    const [picture] = await readdir(join(dir, 'blobs'));
    await damage(`blobs/${picture}`, 'short', /is missing or not \d+ bytes/);
  });

  it('restore takes the bytes back out when the records fail to load', async () => {
    await useSource();
    const dir = join(root, 'backup');
    await service(source).backup(dir);
    // Every line is valid, but the Account twice breaks its primary key inside the write.
    const accounts = await readFile(join(dir, 'accounts.jsonl'), 'utf8');
    await writeFile(join(dir, 'accounts.jsonl'), accounts + accounts);
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    manifest.counts.accounts = 2;
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));

    const target = { store: await otherStore(), blobs: memoryBlobStore() };
    await expect(service(target).restore(dir)).rejects.toThrow();
    expect(await isEmpty(target)).toBe(true);
  });
});

describe('migrate', () => {
  it('moves to other backends, and Devices carry on signed in, without a resync', async () => {
    const device = await useSource();
    const target = { store: await otherStore(), blobs: memoryBlobStore() };

    expect(await service(source).migrateTo(target)).toEqual({ records: 8, files: 1 });
    expect(await everything(target.store)).toEqual(await everything(source.store));
    await expectCarriesOn(target, device);
  });

  it('moves only the records, leaving the bytes where they are', async () => {
    const device = await useSource();
    const store = await otherStore();

    expect(await service(source).migrateTo({ store })).toEqual({ records: 8, files: 0 });
    await expectCarriesOn({ store, blobs: source.blobs }, device);
  });

  it('moves only the bytes, leaving the records where they are', async () => {
    const device = await useSource();
    const blobs = memoryBlobStore();

    expect(await service(source).migrateTo({ blobs })).toEqual({ records: 0, files: 1 });
    await expectCarriesOn({ store: source.store, blobs }, device);
  });

  it('takes the bytes back out when the records fail to load', async () => {
    await useSource();
    const store = await otherStore();
    const failing: Store = {
      ...store,
      serverBackup: { ...store.serverBackup, write: () => Promise.reject(new Error('boom')) },
    };
    const inner = memoryBlobStore();
    let puts = 0;
    const blobs: BlobStore = {
      ...inner,
      put: (...args) => {
        puts++;
        return inner.put(...args);
      },
    };

    await expect(service(source).migrateTo({ store: failing, blobs })).rejects.toThrow('boom');
    expect(puts).toBe(1);
    expect(await blobs.list()).toEqual([]);
  });

  it('refuses a target that is not empty', async () => {
    await useSource();
    await expect(service(source).migrateTo({ store: source.store })).rejects.toThrow(
      /database to fill/
    );
  });
});

const s3Stores: BlobStore[] = [];
afterAll(async () => {
  for (const store of s3Stores) for (const id of await store.list()) await store.delete(id);
});

async function s3Store(): Promise<BlobStore> {
  const store = await s3BlobStore(
    await s3TestSettings(),
    () => {},
    `server-backup-${randomUUID()}/`
  );
  s3Stores.push(store);
  return store;
}

describe.skipIf(!s3TestEndpoint)('with S3 (S3_TEST_ENDPOINT)', () => {
  it('backs up from S3 and restores into S3', async () => {
    source = { store: source.store, blobs: await s3Store() };
    const device = await useSource();
    const dir = join(root, 'backup');
    await service(source).backup(dir);

    const target = { store: await otherStore(), blobs: await s3Store() };
    await service(target).restore(dir);
    await expectCarriesOn(target, device);
  });

  it('moves the bytes from disk to S3 and back', async () => {
    const device = await useSource();
    const s3 = await s3Store();
    await service(source).migrateTo({ blobs: s3 });
    await expectCarriesOn({ store: source.store, blobs: s3 }, device);
    // That check pushed one more Note into the same Store.
    device.cursor++;

    const disk = await diskBlobStore(join(root, 'back'));
    await service({ store: source.store, blobs: s3 }).migrateTo({ blobs: disk });
    await expectCarriesOn({ store: source.store, blobs: disk }, device);
  });
});
