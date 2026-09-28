import { existsSync } from 'node:fs';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadConfig } from './config.ts';

const USAGE = 'Usage: node dist/cli.js backup <dir>';

/** A consistent copy of DATA_DIR: the database through VACUUM INTO, then the blob files. */
export async function backup(dataDir: string, target: string): Promise<void> {
  const source = join(dataDir, 'younotes.db');
  if (!existsSync(source)) throw new Error(`No database at ${resolve(source)}; is DATA_DIR set?`);
  await mkdir(target, { recursive: true });
  if ((await readdir(target)).length > 0) throw new Error(`${target} is not empty`);

  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    db.prepare('VACUUM INTO ?').run(join(target, 'younotes.db'));
  } finally {
    db.close();
  }
  // Bytes are on disk before the database records them, so every blob the copy knows about
  // already exists; copying the files second can at most add a few it does not know yet.
  await cp(join(dataDir, 'blobs'), join(target, 'blobs'), {
    recursive: true,
    filter: (source) => !source.endsWith(join('blobs', '.tmp')),
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function run(argv: string[]): Promise<number> {
  const [command, dir] = argv;
  if (command === 'backup' && dir) {
    const config = loadConfig(process.env);
    await backup(config.dataDir, resolve(dir));
    console.log(`Backed up ${resolve(config.dataDir)} to ${resolve(dir)}`);
    return 0;
  }
  console.error(USAGE);
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2)).catch((error: Error) => {
    console.error(error.message);
    return 1;
  });
}
