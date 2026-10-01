import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { setTimeout } from 'node:timers/promises';
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { diskBlobStore } from '../infra/blobs/disk.ts';
import { memoryBlobStore } from '../infra/blobs/memory.ts';
import { s3BlobStore } from '../infra/blobs/s3.ts';
import { s3TestEndpoint, s3TestSettings } from '../infra/blobs/testing.ts';
import { BlobSizeMismatchError, type BlobStore } from './BlobStore.ts';

// The S3 store runs only when S3_TEST_ENDPOINT is set (src/infra/blobs/testing.ts).

const ID = '0b7e3e52-4c3a-4f8e-9a57-1f7a2a0f9c11';
const BYTES = Buffer.from('hello, attachment');

let diskRoot: string | undefined;
const s3Stores: BlobStore[] = [];
afterAll(async () => {
  if (diskRoot) await rm(diskRoot, { recursive: true, force: true });
  for (const store of s3Stores) for (const id of await store.list()) await store.delete(id);
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

async function s3Store(): Promise<BlobStore> {
  const store = await s3BlobStore(await s3TestSettings(), () => {}, `test-${randomUUID()}/`);
  s3Stores.push(store);
  return store;
}

describe.each(implementations)('BlobStore (%s)', contract);
describe.skipIf(!s3TestEndpoint)('BlobStore (s3, needs S3_TEST_ENDPOINT)', () =>
  contract('s3', s3Store)
);

function contract(_name: string, create: () => Promise<BlobStore>) {
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

  it('stores nothing from a stream shorter than its size', async () => {
    const short = Readable.from([BYTES.subarray(0, 5), BYTES.subarray(5)]);
    await expect(store.put(ID, short, BYTES.length + 1)).rejects.toBeInstanceOf(
      BlobSizeMismatchError
    );
    expect(await store.has(ID)).toBe(false);
  });

  it('stores nothing from a stream longer than its size', async () => {
    // The first chunk alone is the right size, and the rest comes late: a store must wait for the
    // end of the stream to know, not stop counting once it has `size` bytes.
    const long = Readable.from(
      (async function* () {
        yield BYTES;
        await setTimeout(200);
        yield Buffer.from('!');
      })()
    );
    await expect(store.put(ID, long, BYTES.length)).rejects.toBeInstanceOf(BlobSizeMismatchError);
    expect(await store.has(ID)).toBe(false);
  });

  it('stores nothing when the stream fails', async () => {
    // As when a Device loses its connection mid-upload, with more than 64 KiB already sent:
    // versitygw 1.8 kept such a truncated upload as the object.
    const most = Buffer.alloc(100_000, 1);
    const failing = Readable.from(
      (async function* () {
        yield most;
        yield BYTES;
        await setTimeout(200);
        throw new Error('connection lost');
      })()
    );
    await expect(store.put(ID, failing, most.length + BYTES.length)).rejects.toThrow(
      'connection lost'
    );
    expect(await store.has(ID)).toBe(false);
  });

  it('deletes, and deleting twice is fine', async () => {
    await store.put(ID, BYTES, BYTES.length);
    await store.delete(ID);
    await store.delete(ID);
    expect(await store.has(ID)).toBe(false);
  });

  it('lists what it holds', async () => {
    expect(await store.list()).toEqual([]);
    await store.put(ID, BYTES, BYTES.length);
    expect(await store.list()).toEqual([ID]);
    await store.delete(ID);
    expect(await store.list()).toEqual([]);
  });

  it('refuses an id that could escape its directory', async () => {
    await expect(store.put('../escape', BYTES, BYTES.length)).rejects.toThrow(/Invalid blob id/);
    await expect(store.has('a/b')).rejects.toThrow(/Invalid blob id/);
  });
}

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

describe.skipIf(!s3TestEndpoint)('s3BlobStore at startup (needs S3_TEST_ENDPOINT)', () => {
  it('waits for a bucket made after it starts, saying why', async () => {
    const settings = { ...(await s3TestSettings()), bucket: `late-${randomUUID()}` };
    const admin = new S3Client(settings);
    const warnings: string[] = [];
    const opening = s3BlobStore(settings, (message) => warnings.push(message));
    const make = () => admin.send(new CreateBucketCommand({ Bucket: settings.bucket }));
    try {
      // A first try may fail otherwise (refused, no answer) while SeaweedFS is still starting.
      await vi.waitFor(
        () => expect(warnings.some((w) => /^Waiting for S3 .*no such bucket/.test(w))).toBe(true),
        { timeout: 3000 }
      );
      await make();
      expect(await (await opening).list()).toEqual([]);
    } finally {
      // Made here too when the wait failed, so `opening` ends instead of trying for 30 s.
      await make().catch(() => {});
      await opening.catch(() => undefined);
      await admin.send(new DeleteBucketCommand({ Bucket: settings.bucket })).catch(() => {});
      admin.destroy();
    }
  });

  it.skipIf(!process.env.S3_TEST_ACCESS_KEY_ID)('fails at once on keys S3 refuses', async () => {
    const settings = await s3TestSettings();
    const credentials = { accessKeyId: 'younotes', secretAccessKey: 'not-the-key' };
    const started = Date.now();
    await expect(s3BlobStore({ ...settings, credentials }, () => {})).rejects.toThrow(
      /^Cannot use S3 bucket .*access denied/
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
