import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  paginateListObjectsV2,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { Warn } from '../../shared/warn.ts';
import {
  assertBlobId,
  BlobSizeMismatchError,
  type BlobStore,
  SAFE_ID,
} from '../../store/BlobStore.ts';
import { unreachable, waitFor } from '../waitFor.ts';

export type S3Settings = {
  /** Unset means AWS itself. */
  endpoint?: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  /** Unset means the SDK's default credential chain. */
  credentials?: { accessKeyId: string; secretAccessKey: string };
};

/**
 * The bucket stays private and bytes always stream through the server (PLAN.md "Rework", R5): no
 * presigned URLs, since Share Link checks and the blob CSP header hold only for bytes it sends.
 */
export async function s3BlobStore(
  settings: S3Settings,
  warn: Warn,
  prefix = ''
): Promise<BlobStore> {
  const { bucket } = settings;
  const config: S3ClientConfig = {
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: settings.credentials,
    // Plain Content-Length uploads: the SDK's default, an aws-chunked body with a trailing
    // checksum, is not accepted by every S3-compatible service.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    // With the default logger the SDK still prints a console warning on every failed upload.
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };

  // One attempt per try: waitFor retries, judging each failure by its own cause rather than by the
  // SDK's last retry running out of time.
  const check = new S3Client({ ...config, maxAttempts: 1 });
  try {
    await waitFor(
      `S3 bucket "${bucket}" at ${settings.endpoint ?? `AWS (${settings.region})`}`,
      (timeoutMs) =>
        check.send(new HeadBucketCommand({ Bucket: bucket }), {
          abortSignal: AbortSignal.timeout(timeoutMs),
        }),
      judged,
      warn
    );
  } finally {
    check.destroy();
  }
  const client = new S3Client(config);

  const keyOf = (id: string) => {
    assertBlobId(id);
    return prefix + id;
  };

  return {
    async put(id, data, size) {
      const key = keyOf(id);
      const body = exactly(size);
      const upload = new AbortController();
      // The SDK pipes the body without listening for its errors: without this abort, a failed
      // source or size check would leave the request hanging.
      pipeline(Buffer.isBuffer(data) ? Readable.from([data]) : data, body).catch(() =>
        upload.abort()
      );
      try {
        await client.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentLength: size }),
          { abortSignal: upload.signal }
        );
      } catch (error) {
        throw body.errored ?? error;
      } finally {
        // Releases the source when S3 failed first and stopped reading.
        body.destroy();
      }
    },
    async get(id) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: keyOf(id) }));
        return object.Body as Readable;
      } catch (error) {
        if (error instanceof NoSuchKey) return undefined;
        throw error;
      }
    },
    async has(id) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: keyOf(id) }));
        return true;
      } catch (error) {
        if (error instanceof NotFound) return false;
        throw error;
      }
    },
    async delete(id) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: keyOf(id) }));
    },
    async list() {
      const ids: string[] = [];
      for await (const page of paginateListObjectsV2(
        { client },
        { Bucket: bucket, Prefix: prefix }
      )) {
        for (const { Key } of page.Contents ?? []) {
          const id = Key?.slice(prefix.length);
          if (id && SAFE_ID.test(id)) ids.push(id);
        }
      }
      return ids;
    },
  };
}

/**
 * Passes on exactly `size` bytes or fails. S3 stores an object once it has received all
 * ContentLength bytes, so the last chunk is held back until the source has ended with the right
 * total; a body that is too short or too long never delivers its final byte and stores nothing.
 */
function exactly(size: number): Transform {
  let seen = 0;
  let held: Buffer | undefined;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      // An empty chunk would take the held one's place and let the final byte through early.
      if (chunk.length === 0) return done();
      seen += chunk.length;
      if (seen > size) return done(new BlobSizeMismatchError(size, seen));
      if (held) this.push(held);
      held = chunk;
      done();
    },
    flush(done) {
      if (seen !== size) return done(new BlobSizeMismatchError(size, seen));
      done(null, held);
    },
  });
}

/**
 * Reads only the error's code and status, never a key. A bucket not made yet or a server still
 * starting may pass on a retry; keys S3 refuses never do.
 */
function judged(error: unknown): { reason: string; retry: boolean } {
  const { name, code, $metadata } = error as {
    name?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const status = $metadata?.httpStatusCode;
  const retry =
    status === undefined ? name !== 'CredentialsProviderError' : status === 404 || status >= 500;
  if (status === 404) return { reason: 'no such bucket (HTTP 404)', retry };
  if (status === 403) {
    return { reason: 'access denied; check the keys and what they may do (HTTP 403)', retry };
  }
  if (name === 'AbortError') return { reason: 'no answer', retry };
  const named = [code ?? name, status && `HTTP ${status}`].filter(Boolean).join(', ');
  return { reason: unreachable(error) ?? named, retry };
}
