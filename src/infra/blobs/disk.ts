import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  assertBlobId,
  BlobSizeMismatchError,
  type BlobStore,
  SAFE_ID,
} from '../../store/BlobStore.ts';

/** Bytes as files (thesis ADR 0002); a reader never sees a partial file (blobs.md). */
export async function diskBlobStore(dir: string): Promise<BlobStore> {
  const tmp = join(dir, '.tmp');
  await mkdir(tmp, { recursive: true });

  const pathOf = (id: string) => {
    assertBlobId(id);
    return join(dir, id);
  };

  return {
    async put(id, data, size) {
      const target = pathOf(id);
      const temp = join(tmp, randomUUID());
      try {
        const source = Buffer.isBuffer(data) ? Readable.from([data]) : data;
        // fsync file and directory, so a power cut cannot leave a renamed but short file.
        await pipeline(source, createWriteStream(temp, { flags: 'wx', flush: true }));
        const written = (await stat(temp)).size;
        if (written !== size) throw new BlobSizeMismatchError(size, written);
        await rename(temp, target);
        await syncDirectory(dir);
      } finally {
        await rm(temp, { force: true });
      }
    },
    async get(id) {
      try {
        return (await open(pathOf(id))).createReadStream();
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },
    async has(id) {
      try {
        return (await stat(pathOf(id))).isFile();
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },
    async delete(id) {
      await rm(pathOf(id), { force: true });
    },
    async list() {
      // `.tmp` fails SAFE_ID, so writes in progress are never listed.
      return (await readdir(dir)).filter((name) => SAFE_ID.test(name));
    },
  };
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

async function syncDirectory(dir: string): Promise<void> {
  const handle = await open(dir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
