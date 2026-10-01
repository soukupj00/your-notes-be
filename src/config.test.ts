import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadTargetConfig, REDACT } from './config.ts';

describe('loadConfig', () => {
  it('fills every default from an empty environment', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      host: '0.0.0.0',
      dataDir: './data',
      publicDir: './public',
      pageSize: 50,
      tombstoneDays: 90,
      sessionTtlDays: 365,
      bodyLimitBytes: 5 * 1024 * 1024,
      blobLimitBytes: 100 * 1024 * 1024,
      logLevel: 'info',
      trustProxy: false,
      publicUrl: 'http://localhost:3000',
      database: { kind: 'sqlite' },
      blobStore: { kind: 'disk' },
    });
  });

  it('reads and coerces variables', () => {
    const config = loadConfig({
      PORT: '8080',
      PAGE_SIZE: '200',
      TRUST_PROXY: 'true',
      DATA_DIR: '/data',
      PUBLIC_URL: 'https://notes.example',
    });
    expect(config).toMatchObject({
      port: 8080,
      pageSize: 200,
      trustProxy: true,
      dataDir: '/data',
      publicUrl: 'https://notes.example',
    });
  });

  it('defaults the public URL to localhost on the configured port', () => {
    expect(loadConfig({ PORT: '8080' }).publicUrl).toBe('http://localhost:8080');
  });

  it('treats an empty variable as unset', () => {
    expect(loadConfig({ PORT: '' }).port).toBe(3000);
  });

  it('caps the page size at 200', () => {
    expect(() => loadConfig({ PAGE_SIZE: '201' })).toThrow(/PAGE_SIZE/);
  });

  it('reads the S3 Blob Store settings', () => {
    const config = loadConfig({
      BLOB_STORE: 's3',
      S3_ENDPOINT: 'http://s3:8333',
      S3_BUCKET: 'younotes',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_FORCE_PATH_STYLE: 'true',
    });
    expect(config.blobStore).toEqual({
      kind: 's3',
      endpoint: 'http://s3:8333',
      region: 'us-east-1',
      bucket: 'younotes',
      forcePathStyle: true,
      credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
    });
  });

  it("leaves S3 credentials to the SDK's default chain when neither key is set", () => {
    const config = loadConfig({ BLOB_STORE: 's3', S3_BUCKET: 'younotes' });
    expect(config.blobStore).toEqual({
      kind: 's3',
      region: 'us-east-1',
      bucket: 'younotes',
      forcePathStyle: false,
    });
  });

  it('moves the records to PostgreSQL with DATABASE_URL', () => {
    for (const url of ['postgres://u:pw@db:5432/younotes', 'postgresql://u:pw@db/younotes']) {
      expect(loadConfig({ DATABASE_URL: url }).database).toEqual({ kind: 'postgres', url });
    }
  });

  it('refuses a DATABASE_URL of another kind without echoing it', () => {
    const url = 'mysql://u:hunter2@db/younotes';
    expect(() => loadConfig({ DATABASE_URL: url })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: url })).not.toThrow(/hunter2/);
  });

  it('keeps DATABASE_URL out of the log, in a Config or an environment', () => {
    const lines: string[] = [];
    const log = pino({ redact: REDACT }, { write: (line: string) => lines.push(line) });
    const env = { DATABASE_URL: 'postgres://u:hunter2@db/younotes' };
    log.info({ config: loadConfig(env), env }, 'starting');
    log.info(loadConfig(env), 'starting');
    expect(lines).toHaveLength(2);
    expect(lines.join('')).not.toMatch(/hunter2/);
  });

  it('keeps the S3 secret key out of the log, in a Config or an environment', () => {
    const lines: string[] = [];
    const log = pino({ redact: REDACT }, { write: (line: string) => lines.push(line) });
    const env = {
      BLOB_STORE: 's3',
      S3_BUCKET: 'younotes',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI',
    };
    log.info({ config: loadConfig(env), env }, 'starting');
    log.info(loadConfig(env), 'starting');
    log.info(env, 'starting');
    expect(lines).toHaveLength(3);
    expect(lines.join('')).not.toMatch(/wJalrXUtnFEMI/);
  });

  it('requires a bucket for the S3 Blob Store', () => {
    expect(() => loadConfig({ BLOB_STORE: 's3' })).toThrow(/S3_BUCKET/);
  });

  it('requires both S3 keys or neither, without echoing the one given', () => {
    const secret = 'wJalrXUtnFEMI/K7MDENG';
    expect(() => loadConfig({ S3_SECRET_ACCESS_KEY: secret })).toThrow(/S3_ACCESS_KEY_ID/);
    expect(() => loadConfig({ S3_SECRET_ACCESS_KEY: secret })).not.toThrow(secret);
    expect(() => loadConfig({ S3_ACCESS_KEY_ID: 'key' })).toThrow(/S3_SECRET_ACCESS_KEY/);
  });

  it('names an invalid variable without its value', () => {
    expect(() => loadConfig({ BLOB_STORE: 'cloud-9', S3_ENDPOINT: 'not a url' })).toThrow(
      /BLOB_STORE[\s\S]*S3_ENDPOINT/
    );
    expect(() => loadConfig({ BLOB_STORE: 'cloud-9', S3_ENDPOINT: 'not a url' })).not.toThrow(
      /cloud-9|not a url/
    );
  });

  it('names every invalid variable', () => {
    expect(() => loadConfig({ PORT: 'abc', LOG_LEVEL: 'loud', TRUST_PROXY: 'yes' })).toThrow(
      /PORT[\s\S]*LOG_LEVEL[\s\S]*TRUST_PROXY/
    );
  });
});

describe('loadTargetConfig', () => {
  const server = {
    DATA_DIR: '/data',
    DATABASE_URL: 'postgres://u:p@db/younotes',
    BLOB_STORE: 'disk',
  };

  it('takes each TARGET_ variable over its twin and keeps the rest as the server has it', () => {
    const target = loadTargetConfig({ ...server, TARGET_BLOB_STORE: 's3', TARGET_S3_BUCKET: 'b' });
    expect(target).toMatchObject({
      dataDir: '/data',
      database: { kind: 'postgres', url: 'postgres://u:p@db/younotes' },
      blobStore: { kind: 's3', bucket: 'b' },
    });
  });

  it('reads an empty TARGET_ variable as unset, so TARGET_DATABASE_URL= means SQLite', () => {
    expect(loadTargetConfig({ ...server, TARGET_DATABASE_URL: '' }).database).toEqual({
      kind: 'sqlite',
    });
  });
});
