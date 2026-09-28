import type { Readable } from 'node:stream';

/** Where Attachment bytes live. Bytes are write-once by id (frontend ADR 0017). */
export interface BlobStore {
  /** Stores exactly `size` bytes under `id`; rejects, storing nothing, if the data is another size. */
  put(id: string, data: Readable | Buffer, size: number): Promise<void>;
  /** The bytes, or `undefined` when there are none under `id`. */
  get(id: string): Promise<Readable | undefined>;
  has(id: string): Promise<boolean>;
  /** Removes the bytes; a missing id is not an error. */
  delete(id: string): Promise<void>;
}

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Blob ids become file names, so anything but a plain token is refused before it reaches a path. */
export function assertBlobId(id: string): void {
  if (!SAFE_ID.test(id)) throw new Error(`Invalid blob id: ${JSON.stringify(id)}`);
}

export class BlobSizeMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(`Expected ${expected} bytes, received ${actual}`);
    this.name = 'BlobSizeMismatchError';
  }
}
