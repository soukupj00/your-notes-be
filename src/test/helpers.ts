// Shared by the API tests: a real server over in-memory SQLite, and the sign-up steps they all need.
import { expect } from 'vitest';
import { ensureSetupCode } from '../auth/codes.ts';
import { SESSION_COOKIE } from '../auth/sessions.ts';
import { memoryBlobStore } from '../blobs/memory.ts';
import { loadConfig } from '../config.ts';
import { CodeResponse, Problem } from '../contract/index.ts';
import { type Db, openDatabase } from '../db/client.ts';
import { migrateDatabase } from '../db/migrate.ts';
import { type App, buildServer } from '../server.ts';

export const PASSWORD = 'correct horse';

export type Response = Awaited<ReturnType<App['inject']>>;

export async function testServer(
  env: Record<string, string> = {},
  now?: () => Date
): Promise<{ app: App; db: Db }> {
  const db = openDatabase(':memory:');
  migrateDatabase(db);
  const app = await buildServer({
    config: loadConfig({ PUBLIC_DIR: '/nonexistent', ...env }),
    db,
    blobs: memoryBlobStore(),
    logger: false,
    ...(now ? { now } : {}),
  });
  return { app, db };
}

/** Signed in as `cookie`, or signed out. */
export function as(cookie?: string) {
  return cookie ? { cookies: { [SESSION_COOKIE]: cookie } } : {};
}

export function sessionCookie(response: Response) {
  return response.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
}

export function cookieOf(response: Response): string {
  return sessionCookie(response)?.value ?? '';
}

export function expectProblem(response: Response, status: number): Problem {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
  return Problem.parse(response.json());
}

/** Creates the Owner `olga` through a fresh setup code; returns the Laptop's cookie. */
export async function signUpOwner(app: App, db: Db, now = new Date()): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: {
      code: ensureSetupCode(db, now),
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
