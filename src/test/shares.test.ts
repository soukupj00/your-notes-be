import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Problem, Share, SharedNote, SharesResponse, shareLink } from '../contract/index.ts';
import type { App } from '../server.ts';
import type { Store } from '../store/Store.ts';
import {
  as,
  cookieOf,
  expectProblem,
  inviteMember,
  type Response,
  signUpOwner,
  testServer,
} from './helpers.ts';

const T = '2026-09-28T10:00:00.000Z';
const BYTES = Buffer.from('a picture');

let app: App;
let store: Store;
let olga: string;

beforeEach(async () => {
  ({ app, store } = await testServer());
  olga = await signUpOwner(app);
});

afterEach(async () => {
  await app.close();
});

const attachment = (id: string, noteId: string) => ({
  id,
  noteId,
  kind: 'image' as const,
  mime: 'image/png',
  createdAt: T,
  updatedAt: T,
});

/** Pushes a Note, with an uploaded picture, as `cookie`; returns their ids. */
async function noteWithPicture(cookie = olga, state = 'active', rev?: number, ids?: string[]) {
  const [noteId, picture] = ids ?? [randomUUID(), randomUUID()];
  const note = {
    id: noteId,
    state,
    body: '<p>Shopping list</p>',
    attachments: [attachment(picture as string, noteId as string)],
    createdAt: T,
    updatedAt: T,
    ...(rev ? { rev } : {}),
  };
  const pushed = await app.inject({
    method: 'POST',
    url: '/api/changes',
    payload: { notes: [note], tags: [], noteTags: [], tombstones: [] },
    ...as(cookie),
  });
  expect(pushed.json().outcomes[0].status).toBe('accepted');
  await app.inject({
    method: 'PUT',
    url: `/api/blobs/${picture}`,
    payload: BYTES,
    headers: { 'content-type': 'image/png' },
    ...as(cookie),
  });
  return { noteId: noteId as string, picture: picture as string };
}

async function share(noteId: string, cookie = olga): Promise<Response> {
  return app.inject({ method: 'POST', url: '/api/shares', payload: { noteId }, ...as(cookie) });
}

describe('Share Links', () => {
  it('mints a token once per Note, lists it, and builds the link', async () => {
    const { noteId } = await noteWithPicture();
    const first = await share(noteId);
    expect(first.statusCode).toBe(201);
    const minted = Share.parse(first.json());
    expect(minted.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(minted._links.public.href).toBe(`/api/public/shares/${minted.token}`);
    expect(shareLink('https://notes.example/', minted.token)).toBe(
      `https://notes.example/share/${minted.token}`
    );

    const again = await share(noteId);
    expect(again.statusCode).toBe(200);
    expect(Share.parse(again.json())).toEqual(minted);
    const list = SharesResponse.parse(
      (await app.inject({ url: '/api/shares', ...as(olga) })).json()
    );
    expect(list._embedded.shares).toEqual([minted]);
    const self = await app.inject({ url: minted._links.self.href, ...as(olga) });
    expect(Share.parse(self.json())).toEqual(minted);
    expectProblem(await share(randomUUID()), 404);
  });

  it('shows the Note to anyone with the token, without a Session and without a cookie', async () => {
    const { noteId } = await noteWithPicture();
    const { token } = Share.parse((await share(noteId)).json());
    const response = await app.inject({ url: `/api/public/shares/${token}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('private, no-cache');
    const shared = SharedNote.parse(response.json());
    expect(shared.note).toMatchObject({ id: noteId, body: '<p>Shopping list</p>' });
    expect(shared.note).not.toHaveProperty('rev');

    // A stale cookie on a public route is left alone, not cleared.
    const withCookie = await app.inject({ url: `/api/public/shares/${token}`, ...as('stale') });
    expect(withCookie.headers['set-cookie']).toBeUndefined();
  });

  it("serves only the shared Note's own attachments", async () => {
    const { noteId, picture } = await noteWithPicture();
    const other = await noteWithPicture();
    const { token } = Share.parse((await share(noteId)).json());

    const bytes = await app.inject({ url: `/api/public/shares/${token}/blobs/${picture}` });
    expect(bytes.statusCode).toBe(200);
    expect(bytes.rawPayload).toEqual(BYTES);
    expect(bytes.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(bytes.headers.etag).toBe(`"${picture}"`);

    const notListed = await app.inject({
      url: `/api/public/shares/${token}/blobs/${other.picture}`,
    });
    expect(Problem.parse(notListed.json()).status).toBe(404);
  });

  it("serves an image's thumbnail through the share too", async () => {
    const [noteId, picture, thumbnail] = [randomUUID(), randomUUID(), randomUUID()];
    const withThumbnail = { ...attachment(picture, noteId), thumbnailId: thumbnail };
    await app.inject({
      method: 'POST',
      url: '/api/changes',
      payload: {
        notes: [
          { id: noteId, state: 'active', attachments: [withThumbnail], createdAt: T, updatedAt: T },
        ],
        tags: [],
        noteTags: [],
        tombstones: [],
      },
      ...as(olga),
    });
    await app.inject({
      method: 'PUT',
      url: `/api/blobs/${thumbnail}`,
      payload: BYTES,
      headers: { 'content-type': 'image/webp' },
      ...as(olga),
    });
    const { token } = Share.parse((await share(noteId)).json());
    const response = await app.inject({ url: `/api/public/shares/${token}/blobs/${thumbnail}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/webp');
  });

  it('answers a revoked, an unknown and a trashed share with the same 404', async () => {
    const { noteId } = await noteWithPicture();
    const minted = Share.parse((await share(noteId)).json());
    const revoke = await app.inject({
      method: 'DELETE',
      url: minted._links.self.href,
      ...as(olga),
    });
    expect(revoke.statusCode).toBe(204);
    const revoked = expectProblem(
      await app.inject({ url: `/api/public/shares/${minted.token}` }),
      404
    );
    const unknown = expectProblem(await app.inject({ url: '/api/public/shares/not-a-token' }), 404);
    expect(revoked).toEqual(unknown);

    const trashed = await noteWithPicture();
    const { token } = Share.parse((await share(trashed.noteId)).json());
    await noteWithPicture(olga, 'trashed', 1, [trashed.noteId, trashed.picture]);
    expect(expectProblem(await app.inject({ url: `/api/public/shares/${token}` }), 404)).toEqual(
      unknown
    );
    expectProblem(
      await app.inject({ url: `/api/public/shares/${token}/blobs/${trashed.picture}` }),
      404
    );
  });

  it('keeps another Account out of a share it does not own', async () => {
    const { noteId } = await noteWithPicture();
    const minted = Share.parse((await share(noteId)).json());
    const max = cookieOf(await inviteMember(app, olga));
    expectProblem(
      await app.inject({ method: 'DELETE', url: minted._links.self.href, ...as(max) }),
      404
    );
    const theirs = SharesResponse.parse(
      (await app.inject({ url: '/api/shares', ...as(max) })).json()
    );
    expect(theirs._embedded.shares).toEqual([]);
    expectProblem(await share(noteId, max), 404);
    expectProblem(await app.inject({ url: '/api/shares' }), 401);
  });

  it('answers 429 after 60 public reads a minute from one address', async () => {
    const read = (remoteAddress: string) =>
      app.inject({ url: '/api/public/shares/unknown', remoteAddress });
    for (let i = 0; i < 60; i++) expect((await read('10.0.0.1')).statusCode).toBe(404);
    expectProblem(await read('10.0.0.1'), 429);
    expect((await read('10.0.0.2')).statusCode).toBe(404);
  });

  it('the sweep removes a share whose Note was purged', async () => {
    const { noteId } = await noteWithPicture();
    const kept = await noteWithPicture();
    await share(noteId);
    await share(kept.noteId);
    await app.inject({
      method: 'POST',
      url: '/api/changes',
      payload: {
        notes: [],
        tags: [],
        noteTags: [],
        tombstones: [{ id: noteId, kind: 'note', deletedAt: T, rev: 1 }],
      },
      ...as(olga),
    });
    await app.services.housekeeping.sweep(new Date());
    const olgaId = (await store.accounts.owner())?.id ?? '';
    const shares = await store.shares.list(olgaId);
    expect(shares.map(({ noteId }) => ({ noteId }))).toEqual([{ noteId: kept.noteId }]);
  });
});
