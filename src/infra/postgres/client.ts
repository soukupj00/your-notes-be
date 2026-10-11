import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import type { Warn } from '../../shared/warn.ts';
import { unreachable, waitFor } from '../waitFor.ts';
import type * as schema from './schema.ts';

/** The node-postgres pool in production, PGlite in tests: the same queries run on both. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Advisory lock keys: "YouN" in ASCII, then which lock. */
const LOCKS = { instance: [0x596f754e, 1], migrations: [0x596f754e, 2] } as const;

/** Where the database is, for messages: never the user or the password. */
export function where(url: string): string {
  const { hostname, port, pathname } = new URL(url);
  return `${hostname}:${port || 5432}${pathname}`;
}

/** Belt and braces: no message leaves with the password in it, whatever the driver said. */
export function scrubbed(message: string, url: string): string {
  const password = decodeURIComponent(new URL(url).password);
  return password ? message.replaceAll(password, '***') : message;
}

/**
 * 28xxx (authorization) and 3D000 (no such database) do not fix themselves. Anything else may be
 * the database still starting: refused, dropped by a container's port proxy, or "starting up".
 */
function retryable(error: unknown): boolean {
  const code = (error as { code?: string }).code ?? '';
  return !code.startsWith('28') && code !== '3D000';
}

export function connect(url: string, warn: Warn): Promise<pg.Client> {
  return waitFor(
    `PostgreSQL at ${where(url)}`,
    async (timeoutMs) => {
      const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
      try {
        await client.connect();
        return client;
      } catch (error) {
        await client.end().catch(() => undefined);
        throw error;
      }
    },
    (error) => ({
      reason: unreachable(error) ?? scrubbed((error as Error).message, url),
      retry: retryable(error),
    }),
    warn
  );
}

/**
 * Holds the one-instance lock for as long as `client` stays connected (ADR 0006); throws when
 * another server holds it.
 */
export async function holdInstanceLock(client: pg.Client, url: string): Promise<void> {
  const { rows } = await client.query<{ locked: boolean }>(
    'select pg_try_advisory_lock($1, $2) as locked',
    [...LOCKS.instance]
  );
  if (!rows[0]?.locked) {
    throw new Error(
      `Another YourNotes server is already using PostgreSQL at ${where(url)}; ` +
        'only one may run at a time, so stop the other first'
    );
  }
}

/** Runs `migrate` while no other process migrates the same database. */
export async function whileMigrating(client: pg.Client, migrate: () => Promise<void>) {
  await client.query('select pg_advisory_lock($1, $2)', [...LOCKS.migrations]);
  try {
    await migrate();
  } finally {
    await client.query('select pg_advisory_unlock($1, $2)', [...LOCKS.migrations]);
  }
}

export function openPool(url: string, warn: Warn): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 10_000 });
  // An idle connection the server dropped; the pool replaces it, and unheard it would crash us.
  pool.on('error', (error) =>
    warn(`PostgreSQL dropped a connection: ${scrubbed(error.message, url)}`)
  );
  return pool;
}
