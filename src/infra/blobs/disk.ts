import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  assertBlobId,
  BlobSizeMismatchError,
  type BlobStore,
  SAFE_ID,
} from '../../store/BlobStore.ts';

/**
 * Bytes as files (thesis ADR 0002). A write lands in `.tmp` and is renamed into place once its
 * size checks out, so a reader never sees a partial file.
 */
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
        await pipeline(source, createWriteStream(temp, { flags: 'wx' }));
        const written = (await stat(temp)).size;
        if (written !== size) throw new BlobSizeMismatchError(size, written);
        await rename(temp, target);
      } finally {
        await rm(temp, { force: true });
      }
    },
    async get(id) {
      const path = pathOf(id);
      try {
        await stat(path);
      } catch {
        return undefined;
      }
      return createReadStream(path);
    },
    async has(id) {
      try {
        return (await stat(pathOf(id))).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
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
