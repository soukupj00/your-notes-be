import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BlobSizeMismatchError, type BlobStore } from './BlobStore.ts';
import { diskBlobStore } from './disk.ts';
import { memoryBlobStore } from './memory.ts';

const ID = '0b7e3e52-4c3a-4f8e-9a57-1f7a2a0f9c11';
const BYTES = Buffer.from('hello, attachment');

let diskRoot: string | undefined;
afterAll(async () => {
  if (diskRoot) await rm(diskRoot, { recursive: true, force: true });
});

const implementations: [string, () => Promise<BlobStore>][] = [
  ['memory', async () => memoryBlobStore()],
  [
    'disk',
    async () => {
      diskRoot ??= await mkdtemp(join(tmpdir(), 'younotes-blobs-'));
      return diskBlobStore(await mkdtemp(join(diskRoot, 'store-')));
    },
  ],
];

describe.each(implementations)('BlobStore (%s)', (_name, create) => {
  let store: BlobStore;
  beforeEach(async () => {
    store = await create();
  });

  it('knows nothing about an id it was never given', async () => {
    expect(await store.has(ID)).toBe(false);
    expect(await store.get(ID)).toBeUndefined();
  });

  it('returns the bytes it was given as a buffer', async () => {
    await store.put(ID, BYTES, BYTES.length);
    expect(await store.has(ID)).toBe(true);
    expect(await buffer((await store.get(ID))!)).toEqual(BYTES);
  });

  it('returns the bytes it was given as a stream', async () => {
    await store.put(ID, Readable.from([BYTES.subarray(0, 5), BYTES.subarray(5)]), BYTES.length);
    expect(await buffer((await store.get(ID))!)).toEqual(BYTES);
  });

  it('stores nothing when the size does not match', async () => {
    await expect(store.put(ID, BYTES, BYTES.length + 1)).rejects.toBeInstanceOf(
      BlobSizeMismatchError
    );
    expect(await store.has(ID)).toBe(false);
  });

  it('deletes, and deleting twice is fine', async () => {
    await store.put(ID, BYTES, BYTES.length);
    await store.delete(ID);
    await store.delete(ID);
    expect(await store.has(ID)).toBe(false);
  });

  it('refuses an id that could escape its directory', async () => {
    await expect(store.put('../escape', BYTES, BYTES.length)).rejects.toThrow(/Invalid blob id/);
    await expect(store.has('a/b')).rejects.toThrow(/Invalid blob id/);
  });
});

describe('diskBlobStore', () => {
  it('leaves no temp file behind after a rejected write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'younotes-blobs-'));
    try {
      const store = await diskBlobStore(dir);
      await expect(store.put(ID, BYTES, 1)).rejects.toThrow();
      expect(await readdir(join(dir, '.tmp'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
