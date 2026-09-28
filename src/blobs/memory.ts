import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { assertBlobId, BlobSizeMismatchError, type BlobStore } from './BlobStore.ts';

/** For tests: the same contract as the disk store, held in a Map. */
export function memoryBlobStore(): BlobStore {
  const bytes = new Map<string, Buffer>();
  return {
    async put(id, data, size) {
      assertBlobId(id);
      const all = Buffer.isBuffer(data) ? data : await buffer(data);
      if (all.length !== size) throw new BlobSizeMismatchError(size, all.length);
      bytes.set(id, all);
    },
    async get(id) {
      assertBlobId(id);
      const stored = bytes.get(id);
      return stored ? Readable.from([stored]) : undefined;
    },
    async has(id) {
      assertBlobId(id);
      return bytes.has(id);
    },
    async delete(id) {
      assertBlobId(id);
      bytes.delete(id);
    },
  };
}
