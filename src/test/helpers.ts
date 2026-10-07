import { expect } from 'vitest';
import { loadConfig } from '../config.ts';
import {
  ChangesPage,
  CodeResponse,
  type Note,
  Problem,
  type PushBatch,
  PushResponse,
  type Tag,
} from '../contract/index.ts';
import { SESSION_COOKIE } from '../http/sessionCookie.ts';
import { memoryBlobStore } from '../infra/blobs/memory.ts';
import { openSqliteStore } from '../infra/sqlite/store.ts';
import { type App, buildServer, type ServerDeps } from '../server.ts';
import type { Clock } from '../shared/clock.ts';
import type { BlobStore } from '../store/BlobStore.ts';
import type { Store } from '../store/Store.ts';

export const PASSWORD = 'correct horse';
export const T = '2026-09-28T10:00:00.000Z';

export type Response = Awaited<ReturnType<App['inject']>>;

/** Empty and migrated. Under PGlite (vitest.config.ts) a call empties the file's one database. */
export async function testStore(): Promise<Store> {
  if (process.env.TEST_STORE !== 'pglite') return openSqliteStore(':memory:');
  return (await import('../infra/postgres/testing.ts')).pgliteTestStore();
}

export function testBlobs(): BlobStore {
  return memoryBlobStore();
}

/** A Store passed in stays open when the app closes; one it opens itself closes with it. */
export async function testServer(
  env: Record<string, string> = {},
  now?: Clock,
  overrides: { logger?: ServerDeps['logger']; blobs?: BlobStore; store?: Store } = {}
): Promise<{ app: App; store: Store; blobs: BlobStore }> {
  const store = overrides.store ?? (await testStore());
  const blobs = overrides.blobs ?? testBlobs();
  const app = await buildServer({
    config: loadConfig({ PUBLIC_DIR: '/nonexistent', ...env }),
    store,
    blobs,
    logger: overrides.logger ?? false,
    ...(now ? { now } : {}),
  });
  if (!overrides.store) app.addHook('onClose', () => store.close());
  return { app, store, blobs };
}

export function must<V>(value: V | undefined | null, what: string): V {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

export function as(cookie?: string) {
  return cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {};
}

export function sessionCookie(response: Response) {
  return response.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
}

export function cookieOf(response: Response): string {
  return must(sessionCookie(response)?.value, 'session cookie');
}

export function expectProblem(response: Response, status: number): Problem {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
  return Problem.parse(response.json());
}

/** Creates the Owner `olga` through a fresh setup code; returns the Laptop's cookie. */
export async function signUpOwner(app: App): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: {
      code: await app.services.pairing.renewSetupCode(),
      username: 'olga',
      password: PASSWORD,
      deviceName: 'Laptop',
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return cookieOf(response);
}

export async function mintPairingCode(
  app: App,
  cookie: string,
  kind: 'device' | 'invite'
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/codes',
    payload: { kind },
    ...as(cookie),
  });
  expect(response.statusCode, response.body).toBe(201);
  return CodeResponse.parse(response.json()).code;
}

/** Adds a Device to the cookie's Account with a device code; returns the new Device's response. */
export async function pairDevice(app: App, cookie: string, deviceName = 'Phone') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { code: await mintPairingCode(app, cookie, 'device'), deviceName },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response;
}

/** An Invite from the Owner spent by `username`; returns the member's response. */
export async function inviteMember(app: App, ownerCookie: string, username = 'max') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/accounts',
    payload: {
      code: await mintPairingCode(app, ownerCookie, 'invite'),
      username,
      password: PASSWORD,
      deviceName: 'Phone',
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response;
}

export const note = (id: string, extra: Partial<Note> & { rev?: number } = {}) => ({
  id,
  state: 'active' as const,
  createdAt: T,
  updatedAt: T,
  ...extra,
});
export const tag = (id: string, extra: Partial<Tag> & { rev?: number } = {}) => ({
  id,
  name: 'Work',
  createdAt: T,
  updatedAt: T,
  ...extra,
});
export const link = (noteId: string, tagId: string) => ({
  noteId,
  tagId,
  createdAt: T,
  updatedAt: T,
});
export const batch = (rows: Partial<PushBatch>): PushBatch => ({
  notes: [],
  tags: [],
  noteTags: [],
  tombstones: [],
  ...rows,
});

export async function push(app: App, cookie: string, rows: Partial<PushBatch>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/changes',
    payload: batch(rows),
    ...as(cookie),
  });
  expect(response.statusCode, response.body).toBe(200);
  return PushResponse.parse(response.json());
}

export async function pull(app: App, cookie: string, since = 0) {
  const response = await app.inject({ url: `/api/changes?since=${since}`, ...as(cookie) });
  expect(response.statusCode, response.body).toBe(200);
  return ChangesPage.parse(response.json());
}
