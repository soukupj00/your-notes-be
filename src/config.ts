import { z } from 'zod';
import type { S3Settings } from './infra/blobs/s3.ts';

const MIB = 1024 * 1024;

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATA_DIR: z.string().min(1).default('./data'),
  PUBLIC_DIR: z.string().min(1).default('./public'),
  PAGE_SIZE: z.coerce.number().int().min(1).max(200).default(50),
  TOMBSTONE_DAYS: z.coerce.number().int().min(1).default(90),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(365),
  BODY_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(5 * MIB),
  BLOB_LIMIT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(100 * MIB),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool.default(false),
  /** The origin Devices open; printed Pairing Links point here. */
  PUBLIC_URL: z.url().optional(),
  /** Selects PostgreSQL for the records instead of the SQLite file in DATA_DIR (ADR 0006). */
  DATABASE_URL: z
    .url({ protocol: /^postgres(ql)?$/, error: 'must be a valid postgres:// or postgresql:// URL' })
    .optional(),
  BLOB_STORE: z.enum(['disk', 's3']).default('disk'),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1).optional(),
  // Without the slash, a foreign key `notes-2024` under `notes` would list as blob `-2024`.
  S3_PREFIX: z
    .string()
    .regex(/^(.*\/)?$/, 'empty or ending in /')
    .default('younotes/'),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),
});

const EnvSchema = ConfigSchema.superRefine((env, ctx) => {
  const problem = (variable: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [variable], message });
  if (env.BLOB_STORE === 's3' && !env.S3_BUCKET) {
    problem('S3_BUCKET', 'required when BLOB_STORE=s3');
  }
  // One key without the other is a typo, not a request for the SDK's default credentials.
  if (env.S3_ACCESS_KEY_ID && !env.S3_SECRET_ACCESS_KEY) {
    problem('S3_SECRET_ACCESS_KEY', 'required with S3_ACCESS_KEY_ID');
  }
  if (env.S3_SECRET_ACCESS_KEY && !env.S3_ACCESS_KEY_ID) {
    problem('S3_ACCESS_KEY_ID', 'required with S3_SECRET_ACCESS_KEY');
  }
});

export type Config = {
  port: number;
  host: string;
  dataDir: string;
  publicDir: string;
  pageSize: number;
  tombstoneDays: number;
  sessionTtlDays: number;
  bodyLimitBytes: number;
  blobLimitBytes: number;
  logLevel: z.infer<typeof ConfigSchema>['LOG_LEVEL'];
  trustProxy: boolean;
  publicUrl: string;
  /** `url` carries the database password, so it is redacted from every log (`REDACT`). */
  database: { kind: 'sqlite' } | { kind: 'postgres'; url: string };
  blobStore: { kind: 'disk' } | ({ kind: 's3' } & S3Settings);
};

/** Where DATABASE_URL or the S3 secret key sit in a Config or an environment, whole or nested. */
export const REDACT = [
  'database.url',
  '*.database.url',
  'DATABASE_URL',
  '*.DATABASE_URL',
  'blobStore.credentials.secretAccessKey',
  '*.blobStore.credentials.secretAccessKey',
  'S3_SECRET_ACCESS_KEY',
  '*.S3_SECRET_ACCESS_KEY',
];

/** Throws naming every bad variable, never its value, so a secret cannot reach a log. */
export function loadConfig(
  env: Record<string, string | undefined>,
  what = 'configuration'
): Config {
  // An empty variable (`PORT=` in an env file) means "use the default", not "invalid";
  // only `S3_PREFIX=` keeps its empty value, the bucket root.
  const present = Object.fromEntries(
    Object.entries(env).filter(([name, value]) => value !== '' || name === 'S3_PREFIX')
  );
  const result = EnvSchema.safeParse(present);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    throw new Error(`Invalid ${what}:\n  ${problems.join('\n  ')}`);
  }
  const c = result.data;
  return {
    port: c.PORT,
    host: c.HOST,
    dataDir: c.DATA_DIR,
    publicDir: c.PUBLIC_DIR,
    pageSize: c.PAGE_SIZE,
    tombstoneDays: c.TOMBSTONE_DAYS,
    sessionTtlDays: c.SESSION_TTL_DAYS,
    bodyLimitBytes: c.BODY_LIMIT_BYTES,
    blobLimitBytes: c.BLOB_LIMIT_BYTES,
    logLevel: c.LOG_LEVEL,
    trustProxy: c.TRUST_PROXY,
    publicUrl: c.PUBLIC_URL ?? `http://localhost:${c.PORT}`,
    database: c.DATABASE_URL ? { kind: 'postgres', url: c.DATABASE_URL } : { kind: 'sqlite' },
    blobStore:
      c.BLOB_STORE === 's3'
        ? {
            kind: 's3',
            endpoint: c.S3_ENDPOINT,
            region: c.S3_REGION,
            bucket: c.S3_BUCKET!,
            prefix: c.S3_PREFIX,
            forcePathStyle: c.S3_FORCE_PATH_STYLE,
            credentials:
              c.S3_ACCESS_KEY_ID && c.S3_SECRET_ACCESS_KEY
                ? { accessKeyId: c.S3_ACCESS_KEY_ID, secretAccessKey: c.S3_SECRET_ACCESS_KEY }
                : undefined,
          }
        : { kind: 'disk' },
  };
}

const TARGET = 'TARGET_';

/** Where `migrate` copies to: each TARGET_ variable overrides its unprefixed twin. */
export function loadTargetConfig(env: Record<string, string | undefined>): Config {
  const target = Object.entries(env)
    .filter(([name]) => name.startsWith(TARGET))
    .map(([name, value]) => [name.slice(TARGET.length), value]);
  return loadConfig({ ...env, ...Object.fromEntries(target) }, 'target (TARGET_ variables)');
}
