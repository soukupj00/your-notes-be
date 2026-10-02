import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { HealthResponse, Problem, RootResponse } from './contract/index.ts';
import { LOG_SERIALIZERS } from './http/security.ts';
import { memoryBlobStore } from './infra/blobs/memory.ts';
import { type App, buildServer } from './server.ts';
import type { Store } from './store/Store.ts';
import { testStore } from './test/helpers.ts';

const INDEX_HTML = '<!doctype html><title>YouNotes</title>';
const BODY_LIMIT = 2048;

let app: App;
let store: Store;
let publicDir: string;

beforeAll(async () => {
  publicDir = await mkdtemp(join(tmpdir(), 'younotes-public-'));
  await writeFile(join(publicDir, 'index.html'), INDEX_HTML);
  await writeFile(join(publicDir, 'app.js'), 'console.log(1)');
  store = await testStore();

  app = await buildServer({
    config: loadConfig({ PUBLIC_DIR: publicDir, BODY_LIMIT_BYTES: String(BODY_LIMIT) }),
    store,
    blobs: memoryBlobStore(),
    logger: false,
  });
  // Stand-ins for an unsafe route and a private one, to exercise the hooks around them.
  app.post('/api/echo', async (request) => ({ received: request.body }));
  app.get('/api/private', { config: { auth: true } }, async () => ({ secret: true }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await store.close();
  await rm(publicDir, { recursive: true, force: true });
});

function expectProblem(
  response: { headers: Record<string, unknown>; json(): unknown },
  status: number
) {
  expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
  const problem = Problem.parse(response.json());
  expect(problem.status).toBe(status);
  return problem;
}

describe('meta routes', () => {
  it('GET /health reports ok and the version', async () => {
    const response = await app.inject('/health');
    expect(response.statusCode).toBe(200);
    expect(HealthResponse.parse(response.json())).toEqual({ status: 'ok', version: '0.1.0' });
  });

  it('GET /api is a HAL root that links only to routes that exist', async () => {
    const response = await app.inject('/api');
    expect(response.statusCode).toBe(200);
    const root = RootResponse.parse(response.json());
    expect(root._links.setup).toBeDefined();
    // Some links are POST targets, and some answer 401 while signed out; none may be missing.
    const postOnly = new Set(['codes', 'accounts']);
    for (const [rel, { href }] of Object.entries(root._links)) {
      const method = postOnly.has(rel) ? 'POST' : 'GET';
      expect((await app.inject({ method, url: href, payload: {} })).statusCode, href).not.toBe(404);
    }
  });

  it('GET /api/docs/json is an OpenAPI 3.1 document describing the routes', async () => {
    const response = await app.inject('/api/docs/json');
    expect(response.statusCode).toBe(200);
    const doc = response.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/api', '/health']));
  });

  it('GET /api/docs serves the UI from bundled assets', async () => {
    const response = await app.inject('/api/docs/');
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toMatch(/https?:\/\/(cdn|unpkg)/);
  });
});

describe('the PWA and the fallback', () => {
  it('serves index.html at /', async () => {
    const response = await app.inject('/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.body).toBe(INDEX_HTML);
  });

  it('serves static files as themselves', async () => {
    const response = await app.inject('/app.js');
    expect(response.body).toBe('console.log(1)');
  });

  it('falls back to index.html for a client route', async () => {
    const response = await app.inject('/notes/some/route');
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(INDEX_HTML);
  });

  it('answers an unknown /api path with a problem, not the app', async () => {
    for (const url of ['/api/x', '/api/x/y?z=1']) {
      expectProblem(await app.inject(url), 404);
    }
  });

  it('answers an unknown non-GET with a problem', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/notes/1' });
    expectProblem(response, 404);
  });
});

describe('security', () => {
  it('sets the four security headers and a request id on every response', async () => {
    for (const url of ['/health', '/', '/api/x']) {
      const { headers } = await app.inject(url);
      expect(headers['x-content-type-options'], url).toBe('nosniff');
      expect(headers['x-frame-options'], url).toBe('DENY');
      expect(headers['referrer-policy'], url).toBe('no-referrer');
      expect(headers['cross-origin-opener-policy'], url).toBe('same-origin');
      expect(headers['x-request-id'], url).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('echoes a well-formed incoming X-Request-Id and replaces a malformed one', async () => {
    const kept = await app.inject({ url: '/health', headers: { 'x-request-id': 'abc-123' } });
    expect(kept.headers['x-request-id']).toBe('abc-123');
    const replaced = await app.inject({ url: '/health', headers: { 'x-request-id': 'a b<c>' } });
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects an unsafe cross-site request with 403', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'sec-fetch-site': 'cross-site' },
      payload: { a: 1 },
    });
    expectProblem(response, 403);
  });

  it('lets same-origin writes and cross-site reads through', async () => {
    const write = await app.inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'sec-fetch-site': 'same-origin' },
      payload: { a: 1 },
    });
    expect(write.json()).toEqual({ received: { a: 1 } });
    const read = await app.inject({ url: '/health', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(read.statusCode).toBe(200);
  });

  it('rejects a body over the limit with 413', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/echo',
      payload: { text: 'x'.repeat(BODY_LIMIT) },
    });
    expectProblem(response, 413);
  });

  it('never logs a Share Link token', async () => {
    const lines: string[] = [];
    const logged = await buildServer({
      config: loadConfig({ PUBLIC_DIR: publicDir }),
      store,
      blobs: memoryBlobStore(),
      logger: pino({ serializers: LOG_SERIALIZERS }, { write: (line: string) => lines.push(line) }),
    });
    // The PWA's Share Link page, which this server sends before the service worker takes over.
    await logged.inject('/share/secret-token-value');
    await logged.inject('/api/public/shares/secret-token-value');
    await logged.inject('/api/public/shares/secret-token-value/blobs/b1?download=1');
    await logged.close();
    const urls = lines.map((line) => JSON.parse(line).req?.url).filter(Boolean);
    expect(urls).toEqual([
      '/share/***',
      '/api/public/shares/***',
      '/api/public/shares/***/blobs/b1?download=1',
    ]);
    expect(lines.join('\n')).not.toContain('secret-token-value');
  });

  it('answers 401 on a route that needs a Session when there is none', async () => {
    expectProblem(await app.inject('/api/private'), 401);
  });

  it('answers malformed JSON with a 400 problem', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expectProblem(response, 400);
  });
});

describe('without a built PWA', () => {
  it('still serves the API and answers / with a problem', async () => {
    const bare = await buildServer({
      config: loadConfig({ PUBLIC_DIR: join(publicDir, 'missing') }),
      store,
      blobs: memoryBlobStore(),
      logger: false,
    });
    expect((await bare.inject('/health')).statusCode).toBe(200);
    expectProblem(await bare.inject('/'), 404);
    await bare.close();
  });
});
