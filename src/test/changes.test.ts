import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ChangesPage,
  noteTagId,
  Problem,
  type PushBatch,
  PushResponse,
} from '../contract/index.ts';
import type { Db } from '../db/client.ts';
import { accounts } from '../db/schema.ts';
import { SESSION_COOKIE } from '../http/sessionCookie.ts';
import type { App } from '../server.ts';
import { as, cookieOf, inviteMember, pairDevice, signUpOwner, testServer } from './helpers.ts';

const T = '2026-09-28T10:00:00.000Z';

let clock: Date;
let db: Db;
let app: App;

afterEach(async () => {
  await app.close();
});

async function start(env: Record<string, string> = {}) {
  clock = new Date(T);
  ({ app, db } = await testServer(env, () => clock));
}

/** The Owner's first Device; `pair` adds another Device, `invite` another Account. */
const owner = () => signUpOwner(app);
const pair = async (cookie: string) => cookieOf(await pairDevice(app, cookie));
const invite = async (cookie: string) => cookieOf(await inviteMember(app, cookie));

const note = (id: string, extra: object = {}) => ({
  id,
  state: 'active' as const,
  createdAt: T,
  updatedAt: T,
  ...extra,
});
const tag = (id: string, extra: object = {}) => ({
  id,
  name: 'Work',
  createdAt: T,
  updatedAt: T,
  ...extra,
});
const link = (noteId: string, tagId: string) => ({ noteId, tagId, createdAt: T, updatedAt: T });

async function push(cookie: string, batch: Partial<PushBatch>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/changes',
    payload: { notes: [], tags: [], noteTags: [], tombstones: [], ...batch },
    ...as(cookie),
  });
  expect(response.statusCode, response.body).toBe(200);
  return PushResponse.parse(response.json());
}

async function pull(cookie: string, since = 0) {
  const response = await app.inject({ url: `/api/changes?since=${since}`, ...as(cookie) });
  expect(response.statusCode, response.body).toBe(200);
  return ChangesPage.parse(response.json());
}

describe('push', () => {
  it('accepts new rows at rev 1 and advances the Sequence once per row', async () => {
    await start();
    const laptop = await owner();
    const [n, t] = [randomUUID(), randomUUID()];
    const result = await push(laptop, { notes: [note(n)], tags: [tag(t)], noteTags: [link(n, t)] });
    expect(result.outcomes).toEqual([
      { kind: 'note', id: n, status: 'accepted', rev: 1 },
      { kind: 'tag', id: t, status: 'accepted', rev: 1 },
      { kind: 'noteTag', id: noteTagId(n, t), status: 'accepted', rev: 1 },
    ]);
    expect(result.seq).toBe(3);
    const page = await pull(laptop);
    expect(page.notes).toEqual([{ ...note(n), rev: 1 }]);
    expect(page.seq).toBe(3);
    expect(page._links.next).toBeUndefined();
  });

  it('accepts an equal rev at rev + 1 and answers a stale one with the server row', async () => {
    await start();
    const laptop = await owner();
    const n = randomUUID();
    await push(laptop, { notes: [note(n)] });
    const edited = await push(laptop, { notes: [note(n, { header: 'Two', rev: 1 })] });
    expect(edited.outcomes[0]).toMatchObject({ status: 'accepted', rev: 2 });
    const stale = await push(laptop, { notes: [note(n, { header: 'Stale', rev: 1 })] });
    expect(stale.outcomes).toEqual([
      {
        kind: 'note',
        id: n,
        status: 'conflict',
        server: { ...note(n, { header: 'Two' }), rev: 2 },
      },
    ]);
    expect(stale.seq).toBe(2);
  });

  it('two Devices: the loser pulls, keeps its text as a Conflicted Copy, and pushes it', async () => {
    await start();
    const laptop = await owner();
    const phone = await pair(laptop);
    const x = randomUUID();
    await push(laptop, { notes: [note(x, { body: 'v1' })] });
    const cursor = (await pull(phone)).seq;

    await push(laptop, { notes: [note(x, { body: 'laptop', rev: 1 })] });
    const lost = await push(phone, { notes: [note(x, { body: 'phone', rev: 1 })] });
    expect(lost.outcomes[0]).toMatchObject({
      status: 'conflict',
      server: { body: 'laptop', rev: 2 },
    });

    const page = await pull(phone, cursor);
    expect(page.notes).toEqual([{ ...note(x, { body: 'laptop' }), rev: 2 }]);
    const copy = randomUUID();
    const kept = await push(phone, {
      notes: [note(copy, { body: 'phone', header: 'Conflicted copy' })],
    });
    expect(kept.outcomes).toEqual([{ kind: 'note', id: copy, status: 'accepted', rev: 1 }]);
  });

  it('a Tombstone removes the row and its links, reaches the feed, and makes the id gone', async () => {
    await start();
    const laptop = await owner();
    const [n, t] = [randomUUID(), randomUUID()];
    await push(laptop, { notes: [note(n)], tags: [tag(t)], noteTags: [link(n, t)] });
    const purge = await push(laptop, {
      tombstones: [{ id: n, kind: 'note', deletedAt: T, rev: 1 }],
    });
    expect(purge.outcomes).toEqual([{ kind: 'note', id: n, status: 'accepted', rev: 2 }]);
    const page = await pull(laptop);
    expect(page.notes).toEqual([]);
    expect(page.noteTags).toEqual([]);
    expect(page.tombstones).toEqual([{ id: n, kind: 'note', deletedAt: T }]);

    const again = await push(laptop, {
      notes: [note(n, { rev: 1 })],
      noteTags: [link(n, t)],
      tombstones: [{ id: n, kind: 'note', deletedAt: T }],
    });
    expect(again.outcomes.map((o) => o.status)).toEqual(['gone', 'gone', 'accepted']);
    expect(again.seq).toBe(purge.seq);
  });

  it('a stale purge conflicts with the newer edit, which survives; an up-to-date one wins', async () => {
    await start();
    const laptop = await owner();
    const phone = await pair(laptop);
    const n = randomUUID();
    await push(laptop, { notes: [note(n, { body: 'v1' })] });
    await push(laptop, { notes: [note(n, { body: 'v2', rev: 1 })] });

    const stale = await push(phone, {
      tombstones: [{ id: n, kind: 'note', deletedAt: T, rev: 1 }],
    });
    expect(stale.outcomes).toEqual([
      { kind: 'note', id: n, status: 'conflict', server: { ...note(n, { body: 'v2' }), rev: 2 } },
    ]);
    let page = await pull(phone);
    expect(page.notes.map((x) => x.body)).toEqual(['v2']);
    expect(page.tombstones).toEqual([]);

    const current = await push(phone, {
      tombstones: [{ id: n, kind: 'note', deletedAt: T, rev: 2 }],
    });
    expect(current.outcomes).toEqual([{ kind: 'note', id: n, status: 'accepted', rev: 3 }]);
    page = await pull(phone);
    expect(page.notes).toEqual([]);
    expect(page.tombstones).toEqual([{ id: n, kind: 'note', deletedAt: T }]);
  });

  it('unlinks and relinks a NoteTag by its composite id', async () => {
    await start();
    const laptop = await owner();
    const [n, t] = [randomUUID(), randomUUID()];
    const id = noteTagId(n, t);
    await push(laptop, { notes: [note(n)], tags: [tag(t)], noteTags: [link(n, t)] });
    await push(laptop, { tombstones: [{ id, kind: 'noteTag', deletedAt: T }] });
    let page = await pull(laptop);
    expect(page.noteTags).toEqual([]);
    expect(page.tombstones).toEqual([{ id, kind: 'noteTag', deletedAt: T }]);

    const relink = await push(laptop, { noteTags: [{ ...link(n, t), rev: 1 }] });
    expect(relink.outcomes).toEqual([{ kind: 'noteTag', id, status: 'accepted', rev: 1 }]);
    page = await pull(laptop);
    expect(page.noteTags).toEqual([{ ...link(n, t), rev: 1 }]);
    expect(page.tombstones).toEqual([]);

    const orphan = await push(laptop, { noteTags: [link(randomUUID(), t)] });
    expect(orphan.outcomes[0]).toMatchObject({ kind: 'noteTag', status: 'gone' });
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/changes',
      payload: {
        notes: [],
        tags: [],
        noteTags: [],
        tombstones: [{ id: n, kind: 'noteTag', deletedAt: T }],
      },
      ...as(laptop),
    });
    expect(Problem.parse(malformed.json()).status).toBe(400);
  });

  it('rejects a batch of more than 500 rows, and a malformed row fails the whole batch', async () => {
    await start();
    const laptop = await owner();
    const big = await app.inject({
      method: 'POST',
      url: '/api/changes',
      payload: {
        notes: Array.from({ length: 300 }, () => note(randomUUID())),
        tags: Array.from({ length: 201 }, () => tag(randomUUID())),
        noteTags: [],
        tombstones: [],
      },
      ...as(laptop),
    });
    expect(Problem.parse(big.json()).status).toBe(400);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/changes',
      payload: { notes: [note(randomUUID()), { id: 'x' }], tags: [], noteTags: [], tombstones: [] },
      ...as(laptop),
    });
    expect(Problem.parse(bad.json()).status).toBe(400);
    expect((await pull(laptop)).seq).toBe(0);
  });
});

describe('the feed', () => {
  it('pages across kinds in Sequence order, with next only on a full page', async () => {
    await start({ PAGE_SIZE: '2' });
    const laptop = await owner();
    const [a, t, b] = [randomUUID(), randomUUID(), randomUUID()];
    await push(laptop, { notes: [note(a)] });
    await push(laptop, { tags: [tag(t)] });
    await push(laptop, { notes: [note(b)] });

    const first = await pull(laptop);
    expect([first.notes.map((n) => n.id), first.tags.map((x) => x.id)]).toEqual([[a], [t]]);
    expect(first._links.next?.href).toBe('/api/changes?since=2&from=0');
    expect(first._links.resume).toEqual(first._links.next);
    const second = await pull(laptop, 2);
    expect(second.notes.map((n) => n.id)).toEqual([b]);
    expect(second._links.next).toBeUndefined();
    expect(second.seq).toBe(3);
    expect(second._links.resume.href).toBe('/api/changes?since=3');
    const resumed = await app.inject({ url: second._links.resume.href, ...as(laptop) });
    expect(ChangesPage.parse(resumed.json()).notes).toEqual([]);
  });

  it('answers a matching If-None-Match with 304, and a changed feed with 200', async () => {
    await start();
    const laptop = await owner();
    await push(laptop, { notes: [note(randomUUID())] });
    const first = await app.inject({ url: '/api/changes', ...as(laptop) });
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
    expect(first.headers['cache-control']).toBe('private, no-cache');
    const same = await app.inject({
      url: '/api/changes',
      headers: { 'if-none-match': etag },
      ...as(laptop),
    });
    expect(same.statusCode).toBe(304);
    expect(same.body).toBe('');
    await push(laptop, { notes: [note(randomUUID())] });
    const changed = await app.inject({
      url: '/api/changes',
      headers: { 'if-none-match': etag },
      ...as(laptop),
    });
    expect(changed.statusCode).toBe(200);
  });

  it('answers 410 to a cursor past the Sequence, as after restoring a backup', async () => {
    await start();
    const laptop = await owner();
    await push(laptop, { notes: [note(randomUUID())] });
    expect((await pull(laptop, 1)).notes).toEqual([]);
    const { resume } = (await pull(laptop))._links;
    expect(resume.href).toBe('/api/changes?since=1');
    // A restore rewinds the Sequence below the kept cursor.
    db.update(accounts).set({ seq: 0 }).run();
    expect(
      Problem.parse((await app.inject({ url: resume.href, ...as(laptop) })).json()).status
    ).toBe(410);
    const ahead = await app.inject({ url: '/api/changes?since=2', ...as(laptop) });
    expect(Problem.parse(ahead.json())).toMatchObject({ status: 410 });
  });

  it('judges a paged resync by where it began, not by its current page', async () => {
    await start({ PAGE_SIZE: '2' });
    const laptop = await owner();
    for (let i = 0; i < 5; i++) await push(laptop, { notes: [note(randomUUID())] });
    // As if the sweep had removed Tombstones up to Sequence 4.
    db.update(accounts).set({ prunedSeq: 4 }).run();

    let href: string | undefined = '/api/changes';
    const ids: string[] = [];
    let pages = 0;
    while (href) {
      const response = await app.inject({ url: href, ...as(laptop) });
      expect(response.statusCode, href).toBe(200);
      const page = ChangesPage.parse(response.json());
      ids.push(...page.notes.map((n) => n.id));
      href = page._links.next?.href;
      pages++;
    }
    expect([pages, ids.length]).toEqual([3, 5]);

    const kept = await app.inject({ url: '/api/changes?since=3', ...as(laptop) });
    expect(Problem.parse(kept.json()).status).toBe(410);
    const passed = await app.inject({ url: '/api/changes?since=2&from=5', ...as(laptop) });
    expect(passed.statusCode).toBe(200);
  });

  it('answers 410 to a cursor older than the swept Tombstones, but not to 0', async () => {
    await start();
    const laptop = await owner();
    const n = randomUUID();
    await push(laptop, { notes: [note(n)] });
    await push(laptop, { tombstones: [{ id: n, kind: 'note', deletedAt: T, rev: 1 }] });
    await app.services.housekeeping.sweep(new Date(clock.getTime() + 91 * 86_400_000));
    const gone = await app.inject({ url: '/api/changes?since=1', ...as(laptop) });
    expect(Problem.parse(gone.json())).toMatchObject({ status: 410 });
    expect((await pull(laptop, 2)).tombstones).toEqual([]);
    expect((await pull(laptop, 0)).seq).toBe(2);
  });

  it("never shows another Account's rows, even under the same id", async () => {
    await start();
    const olga = await owner();
    const max = await invite(olga);
    const shared = randomUUID();
    await push(olga, { notes: [note(shared, { body: 'olga' })] });
    const theirs = await push(max, { notes: [note(shared, { body: 'max' })] });
    expect(theirs.outcomes[0]).toMatchObject({ status: 'accepted', rev: 1 });
    expect((await pull(olga)).notes.map((n) => n.body)).toEqual(['olga']);
    expect((await pull(max)).notes.map((n) => n.body)).toEqual(['max']);
  });

  it('answers 401 without a Session', async () => {
    await start();
    for (const request of [
      { url: '/api/changes' },
      { url: '/api/changes/stream' },
      { method: 'POST' as const, url: '/api/changes', payload: {} },
    ]) {
      expect(Problem.parse((await app.inject(request)).json()).status).toBe(401);
    }
  });
});

describe('Live Update', () => {
  it('sends the current Sequence, then a hint per push from another Device, one stream per Device', async () => {
    await start();
    const laptop = await owner();
    const phone = await pair(laptop);
    await push(laptop, { notes: [note(randomUUID())] });
    const base = await app.listen({ port: 0, host: '127.0.0.1' });

    const open = async () => {
      const response = await fetch(`${base}/api/changes/stream`, {
        headers: { cookie: `${SESSION_COOKIE}=${laptop}` },
      });
      expect(response.headers.get('content-type')).toBe('text/event-stream');
      const reader = (response.body as ReadableStream<Uint8Array>)
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let buffer = '';
      return async (): Promise<string | null> => {
        while (!buffer.includes('\n\n')) {
          const { value, done } = await reader.read();
          if (done) return null;
          buffer += value;
        }
        const [event, ...rest] = buffer.split('\n\n');
        buffer = rest.join('\n\n');
        return event as string;
      };
    };

    const next = await open();
    expect(await next()).toBe('id: 1\nevent: change\ndata:');
    await push(laptop, { notes: [note(randomUUID())] }); // its own push: no hint
    await push(phone, { notes: [note(randomUUID())] });
    expect(await next()).toBe('id: 3\nevent: change\ndata:');

    const replacement = await open();
    expect(await next()).toBeNull();
    expect(await replacement()).toBe('id: 3\nevent: change\ndata:');
  });
});
