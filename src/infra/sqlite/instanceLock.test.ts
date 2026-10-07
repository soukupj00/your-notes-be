import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { holdInstanceLock } from './instanceLock.ts';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'younotes-lock-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

it('is held by one taker at a time, and free again once released', () => {
  const release = holdInstanceLock(dir);
  expect(() => holdInstanceLock(dir)).toThrow(
    `Another YouNotes server is already using ${dir}; only one may run at a time, so stop the other first`
  );
  release();
  holdInstanceLock(dir)();
});

it('refuses while another process holds it, and is free once that process is killed', async () => {
  // The holder drops its release and collects garbage, which must not free the lock.
  const holder = spawn(process.execPath, [
    '--expose-gc',
    '--input-type=module',
    '-e',
    `import { holdInstanceLock } from ${JSON.stringify(new URL('./instanceLock.ts', import.meta.url).href)};
     holdInstanceLock(${JSON.stringify(dir)});
     for (let i = 0; i < 3; i++) {
       gc();
       await new Promise((resolve) => setTimeout(resolve, 10));
     }
     console.log('held');
     setInterval(() => {}, 60_000);`,
  ]);
  try {
    await once(holder.stdout, 'data');
    expect(() => holdInstanceLock(dir)).toThrow(/stop the other first/);
  } finally {
    holder.kill('SIGKILL');
  }
  await once(holder, 'exit');
  holdInstanceLock(dir)();
});

it.skipIf(process.getuid?.() === 0)('refuses a lock file it cannot write', async () => {
  const lockFile = join(dir, 'younotes.lock');
  await writeFile(lockFile, '');
  await chmod(lockFile, 0o444);
  expect(() => holdInstanceLock(dir)).toThrow(/EACCES.*younotes\.lock/);
});

it('adds only the lock file to the data directory', async () => {
  const release = holdInstanceLock(dir);
  try {
    expect(await readdir(dir)).toEqual(['younotes.lock']);
  } finally {
    release();
  }
});
