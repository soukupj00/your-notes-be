import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { backup } from './cli.ts';
import { openDatabase } from './db/client.ts';
import { migrateDatabase } from './db/migrate.ts';

let root: string;
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('backs up the database and the blob files, without temp files', async () => {
  root = await mkdtemp(join(tmpdir(), 'younotes-backup-'));
  const dataDir = join(root, 'data');
  await mkdir(join(dataDir, 'blobs', '.tmp'), { recursive: true });
  await writeFile(join(dataDir, 'blobs', 'abc'), 'bytes');
  await writeFile(join(dataDir, 'blobs', '.tmp', 'partial'), 'half');
  const db = openDatabase(join(dataDir, 'younotes.db'));
  migrateDatabase(db);
  db.$client.close();

  const target = join(root, 'backup');
  await backup(dataDir, target);

  expect((await readdir(target)).sort()).toEqual(['blobs', 'younotes.db']);
  expect(await readdir(join(target, 'blobs'))).toEqual(['abc']);
  const copy = new Database(join(target, 'younotes.db'), { readonly: true });
  const notes = copy.prepare("select count(*) as n from sqlite_master where name = 'notes'").get();
  expect(notes).toEqual({ n: 1 });
  copy.close();
});

it('refuses to back up a data directory without a database', async () => {
  root = await mkdtemp(join(tmpdir(), 'younotes-backup-'));
  await expect(backup(root, join(root, 'backup'))).rejects.toThrow(/No database/);
  expect(await readdir(root)).toEqual([]);
});

it('refuses a target that already has files in it', async () => {
  root = await mkdtemp(join(tmpdir(), 'younotes-backup-'));
  openDatabase(join(root, 'younotes.db')).$client.close();
  await expect(backup(root, root)).rejects.toThrow(/not empty/);
});
