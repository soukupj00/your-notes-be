import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { buffer } from 'node:stream/consumers';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Problem } from '../contract/index.ts';
import { SESSION_COOKIE } from '../http/sessionCookie.ts';
import type { App } from '../server.ts';
import type { BlobStore } from '../store/BlobStore.ts';
import {
  as,
  cookieOf,
  inviteMember,
  type Response,
  signUpOwner,
  testBlobs,
  testServer,
} from './helpers.ts';

const LIMIT = 1024;
const BYTES = Buffer.from('\x89PNG not really');

let app: App;
let blobs: BlobStore;
let olga: string;

beforeEach(async () => {
  ({ app, blobs } = await testServer({ BLOB_LIMIT_BYTES: String(LIMIT) }));
  olga = await signUpOwner(app);
});

afterEach(async () => {
  await app.close();
});

const problem = (r: Response) => Problem.parse(r.json()).status;
const member = async () => cookieOf(await inviteMember(app, olga));

function put(id: string, body: Buffer, cookie = olga, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'PUT',
    url: `/api/blobs/${id}`,
    payload: body,
    headers: { 'content-type': 'image/png', ...headers },
    ...as(cookie),
  });
}

describe('blobs', () => {
  it('stores bytes and serves them back, cacheable forever and never as a page', async () => {
    const id = randomUUID();
    const stored = await put(id, BYTES);
    expect(stored.statusCode).toBe(201);
    expect(stored.headers.location).toBe(`/api/blobs/${id}`);
    expect(stored.body).toBe('');

    const got = await app.inject({ url: `/api/blobs/${id}`, ...as(olga) });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload).toEqual(BYTES);
    expect(got.headers).toMatchObject({
      'content-type': 'image/png',
      'content-length': String(BYTES.length),
      etag: `"${id}"`,
      'cache-control': 'private, max-age=31536000, immutable',
      'content-security-policy': "default-src 'none'; sandbox",
    });

    const head = await app.inject({ method: 'HEAD', url: `/api/blobs/${id}`, ...as(olga) });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-length']).toBe(String(BYTES.length));
    expect(head.headers.etag).toBe(`"${id}"`);

    const cached = await app.inject({
      url: `/api/blobs/${id}`,
      headers: { 'if-none-match': `"${id}"` },
      ...as(olga),
    });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe('');
  });

  it('answers a repeat with 204 and keeps the first bytes', async () => {
    const id = randomUUID();
    await put(id, BYTES);
    const repeat = await put(id, Buffer.from('other bytes'));
    expect(repeat.statusCode).toBe(204);
    expect(await buffer((await blobs.get(id)) as NodeJS.ReadableStream)).toEqual(BYTES);
  });

  it('answers 404 for a record whose bytes are gone, uncached, and takes the next upload', async () => {
    const id = randomUUID();
    await put(id, BYTES);
    await blobs.delete(id);
    const head = () => app.inject({ method: 'HEAD', url: `/api/blobs/${id}`, ...as(olga) });

    const lost = await head();
    expect(lost.statusCode).toBe(404);
    expect(lost.headers['cache-control']).toBeUndefined();
    expect(problem(await app.inject({ url: `/api/blobs/${id}`, ...as(olga) }))).toBe(404);
    const cached = await app.inject({
      url: `/api/blobs/${id}`,
      headers: { 'if-none-match': `"${id}"` },
      ...as(olga),
    });
    expect(cached.statusCode).toBe(404);

    expect((await put(id, BYTES)).statusCode).toBe(201);
    expect((await head()).statusCode).toBe(200);
  });

  it('answers a repeat, and a missing Content-Length, before reading the body', async () => {
    const id = randomUUID();
    await put(id, BYTES);
    const base = new URL(await app.listen({ port: 0, host: '127.0.0.1' }));
    /** Sends only the first 10 bytes: a handler that read the body would never answer. */
    const send = (headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest({
          host: base.hostname,
          port: base.port,
          method: 'PUT',
          path: `/api/blobs/${id}`,
          headers: { 'content-type': 'image/png', cookie: `${SESSION_COOKIE}=${olga}`, ...headers },
        });
        req.on('response', (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
          req.destroy();
        });
        req.on('error', reject);
        req.write(Buffer.alloc(10));
      });
    expect(await send({ 'content-length': '1000' })).toBe(204);
    expect(await send({ 'transfer-encoding': 'chunked' })).toBe(411);
  });

  it('takes an upload the client cancels as no server failure, storing nothing', async () => {
    const lines: { level: number; msg: string }[] = [];
    const inner = testBlobs();
    let started!: () => void;
    const streaming = new Promise<void>((resolve) => {
      started = resolve;
    });
    const watched: BlobStore = {
      ...inner,
      put: (...args) => {
        started();
        return inner.put(...args);
      },
    };
    const { app: logged } = await testServer({}, undefined, {
      blobs: watched,
      logger: pino({}, { write: (line: string) => lines.push(JSON.parse(line)) }),
    });
    try {
      const cookie = await signUpOwner(logged);
      const base = new URL(await logged.listen({ port: 0, host: '127.0.0.1' }));
      const req = httpRequest({
        host: base.hostname,
        port: base.port,
        method: 'PUT',
        path: `/api/blobs/${randomUUID()}`,
        headers: {
          'content-type': 'image/png',
          'content-length': '200000',
          cookie: `${SESSION_COOKIE}=${cookie}`,
        },
      });
      req.on('error', () => {});
      req.write(Buffer.alloc(100_000));
      await streaming;
      const before = lines.length;
      req.destroy();

      await vi.waitFor(() => expect(lines.length).toBeGreaterThan(before));
      expect(lines.slice(before)).toEqual([
        expect.objectContaining({
          level: 30,
          msg: 'the client closed the connection before the request ended',
        }),
      ]);
      expect(await inner.list()).toEqual([]);
    } finally {
      await logged.close();
    }
  });

  it('refuses a body whose size differs from Content-Length, storing nothing', async () => {
    const id = randomUUID();
    const response = await put(id, BYTES, olga, { 'content-length': String(BYTES.length + 3) });
    expect(problem(response)).toBe(400);
    expect(await blobs.has(id)).toBe(false);
    expect((await app.inject({ url: `/api/blobs/${id}`, ...as(olga) })).statusCode).toBe(404);
  });

  it('refuses a missing Content-Type and a Content-Length over the limit', async () => {
    const id = randomUUID();
    const untyped = await app.inject({
      method: 'PUT',
      url: `/api/blobs/${id}`,
      payload: BYTES,
      ...as(olga),
    });
    expect(Problem.parse(untyped.json())).toMatchObject({
      status: 400,
      detail: 'Send the Content-Type of the bytes',
    });
    expect(problem(await put(id, Buffer.alloc(LIMIT + 1)))).toBe(413);
    expect(await blobs.has(id)).toBe(false);
  });

  it("keeps each Account's bytes to itself", async () => {
    const id = randomUUID();
    await put(id, BYTES);
    const max = await member();
    expect(problem(await put(id, BYTES, max))).toBe(404);
    expect(problem(await app.inject({ url: `/api/blobs/${id}`, ...as(max) }))).toBe(404);
    const head = await app.inject({ method: 'HEAD', url: `/api/blobs/${id}`, ...as(max) });
    expect(head.statusCode).toBe(404);
  });

  it('answers 400 to a malformed id and 401 without a Session', async () => {
    expect(problem(await put('not-a-uuid', BYTES))).toBe(400);
    expect(problem(await put('..%2Fescape', BYTES))).toBe(400);
    const id = randomUUID();
    expect(problem(await app.inject({ url: `/api/blobs/${id}` }))).toBe(401);
    expect(
      problem(await app.inject({ method: 'PUT', url: `/api/blobs/${id}`, payload: BYTES }))
    ).toBe(401);
  });
});
