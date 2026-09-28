import { z } from 'zod';

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
};

/** Reads the environment into a validated Config; throws listing every bad variable. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // An empty variable (`PORT=` in an env file) means "use the default", not "invalid".
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = ConfigSchema.safeParse(present);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
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
  };
}
