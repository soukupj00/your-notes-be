import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backup, resetOwnerPassword, restore, run } from './cli.ts';
import { loadConfig } from './config.ts';
import { diskBlobStore } from './infra/blobs/disk.ts';
import { openBlobStore, openStore } from './infra/open.ts';
import { openPostgresStore } from './infra/postgres/store.ts';
import { testDatabase } from './infra/postgres/testing.ts';
import { openSqliteStore } from './infra/sqlite/store.ts';
import { hashPassword, verifyPassword } from './shared/passwords.ts';

let root = '';
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
});

const account = { createdAt: '', passwordHash: '' };

/** A DATA_DIR as the server leaves it: the Owner, with one Attachment's bytes on disk. */
async function dataDir(name = 'data'): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir);
  const store = openSqliteStore(join(dir, 'younotes.db'));
  await store.accounts.add({ id: 'o', username: 'olga', role: 'owner', ...account });
  await store.blobRecords.add({
    id: 'abc',
    accountId: 'o',
    size: 5,
    mime: 'image/png',
    createdAt: '',
  });
  await store.close();
  await (await diskBlobStore(join(dir, 'blobs'))).put('abc', Buffer.from('bytes'), 5);
  return dir;
}

async function contents(env: Record<string, string>) {
  const config = loadConfig(env);
  const store = await openStore(config, { warn: () => {} });
  const owner = await store.accounts.owner();
  await store.close();
  const bytes = await (await openBlobStore(config, () => {})).get('abc');
  return { owner: owner?.username, bytes: bytes && (await buffer(bytes)).toString() };
}

const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
};

describe('backup and restore', () => {
  it('back up a DATA_DIR and restore it into an empty one, once', async () => {
    root = await mkdtemp(join(tmpdir(), 'younotes-cli-'));
    quiet();
    const backupDir = join(root, 'backup');
    expect(await run(['backup', backupDir], { DATA_DIR: await dataDir() })).toBe(0);
    expect(await readdir(backupDir)).toContain('manifest.json');

    const restored = { DATA_DIR: join(root, 'restored') };
    expect(await run(['restore', backupDir], restored)).toBe(0);
    expect(await contents(restored)).toEqual({ owner: 'olga', bytes: 'bytes' });
    await expect(run(['restore', backupDir], restored)).rejects.toThrow(/database to fill/);
  });

  it('refuse to back up a data directory without a database', async () => {
    root = await mkdtemp(join(tmpdir(), 'younotes-cli-'));
    const failing = backup(loadConfig({ DATA_DIR: join(root, 'data') }), join(root, 'backup'));
    await expect(failing).rejects.toThrow(/No database/);
    expect(await readdir(root)).toEqual([]);
  });

  // Root may write anywhere, so this runs only as another user (CI's container is root).
  it.skipIf(process.getuid?.() === 0)(
    'name the folder and the fix when the backups folder is not writable',
    async () => {
      root = await mkdtemp(join(tmpdir(), 'younotes-cli-'));
      const config = loadConfig({ DATA_DIR: await dataDir() });
      const backups = join(root, 'backups');
      await mkdir(backups, { mode: 0o500 });
      const failing = backup(config, join(backups, '2026-10-01'));
      await expect(failing).rejects.toThrow(
        new RegExp(`^Cannot write the backup to ${backups}/2026-10-01: permission denied.*chown`)
      );
      await expect(failing).rejects.toThrow(/sudo chown 1000:1000 backups.*setup\.md, section 8/);
    }
  );

  it('refuse a backup target that already has files in it', async () => {
    root = await mkdtemp(join(tmpdir(), 'younotes-cli-'));
    const config = loadConfig({ DATA_DIR: await dataDir() });
    await expect(backup(config, config.dataDir)).rejects.toThrow(/not empty/);
  });

  it('point a backup made by an earlier version at the guide', async () => {
    root = await mkdtemp(join(tmpdir(), 'younotes-cli-'));
    const old = await dataDir('old-backup');
    const failing = restore(loadConfig({ DATA_DIR: join(root, 'data') }), old);
    await expect(failing).rejects.toThrow(/earlier version.*docs\/setup\.md, section 8/);
  });
});

describe('migrate', () => {
  it('copies the server to where the TARGET_ variables say', async () => {
    root = await mkdtemp(join(tmpdir(), 'younotes-cli-'));
    quiet();
    const target = join(root, 'moved');
    expect(await run(['migrate'], { DATA_DIR: await dataDir(), TARGET_DATA_DIR: target })).toBe(0);
    expect(await contents({ DATA_DIR: target })).toEqual({ owner: 'olga', bytes: 'bytes' });
  });

  it('refuses a target that is not empty, or the same place, or no database', async () => {
    root = await mkdtemp(join(tmpdir(), 'younotes-cli-'));
    quiet();
    const env = { DATA_DIR: await dataDir(), TARGET_DATA_DIR: await dataDir('other') };
    await expect(run(['migrate'], env)).rejects.toThrow(/database to fill/);
    await expect(run(['migrate'], { DATA_DIR: env.DATA_DIR })).rejects.toThrow(/already uses/);
    const missing = { DATA_DIR: join(root, 'nothing'), TARGET_DATA_DIR: join(root, 'new') };
    await expect(run(['migrate'], missing)).rejects.toThrow(/No database/);
  });

  it('names a bad TARGET_ variable as the target, without its value', async () => {
    const env = { DATA_DIR: '/nonexistent', TARGET_DATABASE_URL: 'mysql://me:hunter2@db/younotes' };
    const failing = run(['migrate'], env);
    await expect(failing).rejects.toThrow(/Invalid target \(TARGET_ variables\):\s+DATABASE_URL/);
    await expect(failing).rejects.not.toThrow(/hunter2/);
  });
});

it('prints the usage for anything else', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await run(['migrate', 'somewhere'])).toBe(2);
  expect(error).toHaveBeenCalledWith(expect.stringMatching(/restore <dir>/));
});

it('resets the Owner password to a new random one', async () => {
  root = await mkdtemp(join(tmpdir(), 'younotes-reset-'));
  const path = join(root, 'younotes.db');
  const store = openSqliteStore(path);
  const passwordHash = await hashPassword('old password');
  await store.accounts.add({ id: 'o', username: 'olga', role: 'owner', ...account, passwordHash });
  await store.accounts.add({ id: 'm', username: 'max', role: 'member', ...account, passwordHash });
  await store.close();

  const password = await resetOwnerPassword(loadConfig({ DATA_DIR: root }));
  expect(password).toMatch(/^[A-Za-z0-9_-]{16}$/);
  const check = openSqliteStore(path);
  const olga = await check.accounts.findByUsername('olga');
  const max = await check.accounts.findByUsername('max');
  await check.close();
  expect(await verifyPassword(password, olga?.passwordHash)).toBe(true);
  expect(await verifyPassword('old password', max?.passwordHash)).toBe(true);
});

it('refuses to reset when there is no Owner', async () => {
  root = await mkdtemp(join(tmpdir(), 'younotes-reset-'));
  await openSqliteStore(join(root, 'younotes.db')).close();
  await expect(resetOwnerPassword(loadConfig({ DATA_DIR: root }))).rejects.toThrow(/no Owner/);
});

const pgUrl = process.env.PG_TEST_URL;
describe.skipIf(!pgUrl)('on a real PostgreSQL (PG_TEST_URL)', () => {
  it('resets the Owner password', async () => {
    const database = await testDatabase(pgUrl!);
    try {
      const store = await openPostgresStore(database.url, { warn: () => {} });
      await store.accounts.add({ id: 'o', username: 'olga', role: 'owner', ...account });
      await store.close();

      const config = loadConfig({ DATA_DIR: '/nonexistent', DATABASE_URL: database.url });
      const password = await resetOwnerPassword(config);
      const check = await openPostgresStore(database.url, { warn: () => {} });
      const olga = await check.accounts.findByUsername('olga');
      await check.close();
      expect(await verifyPassword(password, olga?.passwordHash)).toBe(true);
    } finally {
      await database.drop();
    }
  });

  it('migrates SQLite to PostgreSQL, the bytes staying, then backs up and restores it', async () => {
    root = await mkdtemp(join(tmpdir(), 'younotes-cli-'));
    quiet();
    const [first, second] = [await testDatabase(pgUrl!), await testDatabase(pgUrl!)];
    try {
      const data = await dataDir();
      const moved = { DATA_DIR: data, DATABASE_URL: first.url };
      expect(await run(['migrate'], { DATA_DIR: data, TARGET_DATABASE_URL: first.url })).toBe(0);
      expect(await contents(moved)).toEqual({ owner: 'olga', bytes: 'bytes' });

      const backupDir = join(root, 'backup');
      expect(await run(['backup', backupDir], moved)).toBe(0);
      const restored = { DATA_DIR: join(root, 'restored'), DATABASE_URL: second.url };
      expect(await run(['restore', backupDir], restored)).toBe(0);
      expect(await contents(restored)).toEqual({ owner: 'olga', bytes: 'bytes' });
    } finally {
      await first.drop();
      await second.drop();
    }
  });

  it('refuses to migrate or restore while a server runs on the database', async () => {
    root = await mkdtemp(join(tmpdir(), 'younotes-cli-'));
    quiet();
    const database = await testDatabase(pgUrl!);
    const running = await openPostgresStore(database.url, {
      warn: () => {},
      oneInstance: { onLost: () => {} },
    });
    try {
      const data = await dataDir();
      const migrating = run(['migrate'], { DATA_DIR: data, TARGET_DATABASE_URL: database.url });
      await expect(migrating).rejects.toThrow(/Another YouNotes server/);
      const backupDir = join(root, 'backup');
      await run(['backup', backupDir], { DATA_DIR: data });
      const restoring = run(['restore', backupDir], { DATA_DIR: data, DATABASE_URL: database.url });
      await expect(restoring).rejects.toThrow(/Another YouNotes server/);
    } finally {
      await running.close();
      await database.drop();
    }
  });
});
