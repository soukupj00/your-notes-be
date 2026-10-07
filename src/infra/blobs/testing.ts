// For tests only, and left out of the build: the S3 bucket the tests share.
import { randomUUID } from 'node:crypto';
import { CreateBucketCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import type { S3Settings } from './s3.ts';

export const s3TestEndpoint = process.env.S3_TEST_ENDPOINT;

let bucket: Promise<S3Settings> | undefined;

/** The test bucket, created on first use; every call gets a key prefix of its own. */
export async function s3TestSettings(): Promise<S3Settings> {
  bucket ??= createBucket();
  return { ...(await bucket), prefix: `test-${randomUUID()}/` };
}

async function createBucket(): Promise<S3Settings> {
  const env = process.env;
  const settings: S3Settings = {
    endpoint: s3TestEndpoint,
    region: 'us-east-1',
    bucket: env.S3_TEST_BUCKET ?? 'younotes-test',
    prefix: '',
    forcePathStyle: true,
    credentials:
      env.S3_TEST_ACCESS_KEY_ID && env.S3_TEST_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_TEST_ACCESS_KEY_ID, secretAccessKey: env.S3_TEST_SECRET_ACCESS_KEY }
        : undefined,
  };
  const client = new S3Client(settings);
  try {
    await client.send(new CreateBucketCommand({ Bucket: settings.bucket }));
  } catch (error) {
    const owned = ['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'];
    if (!(error instanceof S3ServiceException && owned.includes(error.name))) throw error;
  } finally {
    client.destroy();
  }
  return settings;
}
