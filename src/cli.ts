import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { hashPassword } from './auth/passwords.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/client.ts';
import { accounts } from './db/schema.ts';

const USAGE = `Usage:
  node dist/cli.js backup <dir>
  node dist/cli.js reset-owner-password`;

function databaseIn(dataDir: string): string {
  const path = join(dataDir, 'younotes.db');
  if (!existsSync(path)) throw new Error(`No database at ${resolve(path)}; is DATA_DIR set?`);
  return path;
}

/** A consistent copy of DATA_DIR: the database through VACUUM INTO, then the blob files. */
export async function backup(dataDir: string, target: string): Promise<void> {
  const source = databaseIn(dataDir);
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

/** Gives the Owner a new random 16-character password and returns it; Sessions stay. */
export async function resetOwnerPassword(dataDir: string): Promise<string> {
  const db = openDatabase(databaseIn(dataDir));
  try {
    const password = randomBytes(12).toString('base64url');
    const passwordHash = await hashPassword(password);
    const owner = db
      .update(accounts)
      .set({ passwordHash, updatedAt: new Date().toISOString() })
      .where(eq(accounts.role, 'owner'))
      .returning({ username: accounts.username })
      .get();
    if (!owner) throw new Error('There is no Owner yet; open the Pairing Link in the server log');
    return password;
  } finally {
    db.$client.close();
  }
}

async function run(argv: string[]): Promise<number> {
  const [command, dir] = argv;
  if (command === 'backup' && dir) {
    const config = loadConfig(process.env);
    await backup(config.dataDir, resolve(dir));
    console.log(`Backed up ${resolve(config.dataDir)} to ${resolve(dir)}`);
    return 0;
  }
  if (command === 'reset-owner-password' && !dir) {
    const password = await resetOwnerPassword(loadConfig(process.env).dataDir);
    console.log(`The Owner's new password, shown only this once: ${password}`);
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
