import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Config, loadConfig, loadTargetConfig } from './config.ts';
import {
  blobStoreLocation,
  openBlobStore,
  openStore,
  type StoreOptions,
  sqlitePath,
  storeLocation,
} from './infra/open.ts';
import type { Counts } from './modules/backup/format.ts';
import { type Server, ServerBackupService } from './modules/backup/service.ts';
import { hashPassword } from './shared/passwords.ts';

const USAGE = `Usage:
  node dist/cli.js backup <dir>
  node dist/cli.js restore <dir>
  node dist/cli.js migrate                 to where the TARGET_ variables say
                                           (docs/setup-backends.md, section 3)
  node dist/cli.js reset-owner-password`;

/** A wrong DATA_DIR would otherwise create an empty database. */
function requireDatabase(config: Config): void {
  if (config.database.kind !== 'sqlite') return;
  const path = sqlitePath(config.dataDir);
  if (!existsSync(path)) throw new Error(`No database at ${resolve(path)}; is DATA_DIR set?`);
}

/** Takes the one-instance lock, so a running server makes the command refuse (ADR 0006). */
const alone: StoreOptions = {
  warn: console.warn,
  oneInstance: { onLost: (error) => console.warn(error.message) },
};

async function open(config: Config, options: StoreOptions): Promise<Server> {
  const store = await openStore(config, options);
  try {
    return { store, blobs: await openBlobStore(config, console.warn) };
  } catch (error) {
    await store.close();
    throw error;
  }
}

const serverBackup = (server: Server) =>
  new ServerBackupService(server, () => new Date(), console.warn);

/** Works on a running server, so it takes no one-instance lock. */
export async function backup(config: Config, dir: string): Promise<Counts> {
  requireDatabase(config);
  const server = await open(config, { warn: console.warn });
  try {
    return (await serverBackup(server).backup(dir)).counts;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code !== 'EACCES' && code !== 'EPERM') throw error;
    // The guide's container runs as uid 1000 and writes into a folder mounted from the host.
    throw new Error(
      `Cannot write the backup to ${dir}: permission denied. Its folder must belong to the ` +
        'account YouNotes runs as; with Docker, run `sudo chown 1000:1000 backups` once ' +
        '(docs/setup.md, section 8)'
    );
  } finally {
    await server.store.close();
  }
}

/** Into the server `config` names, which must be stopped and empty. */
export async function restore(config: Config, dir: string): Promise<Counts> {
  const server = await open(config, alone);
  try {
    return (await serverBackup(server).restore(dir)).counts;
  } finally {
    await server.store.close();
  }
}

/** Copies the stopped server that `source` names to wherever `target` differs from it. */
export async function migrate(
  source: Config,
  target: Config
): Promise<{ records: number; files: number }> {
  const moveRecords = storeLocation(source) !== storeLocation(target);
  const moveBytes = blobStoreLocation(source) !== blobStoreLocation(target);
  if (!moveRecords && !moveBytes) {
    throw new Error(
      'The TARGET_ variables name the database and Attachment storage the server already uses; ' +
        'set the ones to move to (docs/setup-backends.md, section 3)'
    );
  }
  requireDatabase(source);
  const server = await open(source, alone);
  try {
    const store = moveRecords ? await openStore(target, alone) : undefined;
    try {
      const blobs = moveBytes ? await openBlobStore(target, console.warn) : undefined;
      return await serverBackup(server).migrateTo({ store, blobs });
    } finally {
      await store?.close();
    }
  } finally {
    await server.store.close();
  }
}

/** Gives the Owner a new random 16-character password and returns it; Sessions stay. */
export async function resetOwnerPassword(config: Config): Promise<string> {
  requireDatabase(config);
  // No one-instance lock: the server keeps running meanwhile.
  const store = await openStore(config, { warn: console.warn });
  try {
    const owner = await store.accounts.owner();
    if (!owner) throw new Error('There is no Owner yet; open the Pairing Link in the server log');
    const password = randomBytes(12).toString('base64url');
    await store.accounts.setPassword(
      owner.id,
      await hashPassword(password),
      new Date().toISOString()
    );
    return password;
  } finally {
    await store.close();
  }
}

const summary = (counts: Counts) =>
  Object.entries(counts)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(', ');

export async function run(argv: string[], env = process.env): Promise<number> {
  const [command, dir] = argv;
  if (command === 'backup' && dir) {
    const counts = await backup(loadConfig(env), resolve(dir));
    console.log(`Backed up to ${resolve(dir)}: ${summary(counts)}`);
    return 0;
  }
  if (command === 'restore' && dir) {
    const counts = await restore(loadConfig(env), resolve(dir));
    console.log(`Restored from ${resolve(dir)}: ${summary(counts)}`);
    return 0;
  }
  if (command === 'migrate' && !dir) {
    const { records, files } = await migrate(loadConfig(env), loadTargetConfig(env));
    console.log(
      `Copied records ${records}, Attachment files ${files}; ` +
        'now point the server at the target (docs/setup-backends.md, section 3)'
    );
    return 0;
  }
  if (command === 'reset-owner-password' && !dir) {
    const password = await resetOwnerPassword(loadConfig(env));
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
