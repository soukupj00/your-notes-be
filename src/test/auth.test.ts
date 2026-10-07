import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Account,
  AccountsResponse,
  CodeResponse,
  DevicesResponse,
  RootResponse,
  SessionResponse,
  SetupStatus,
} from '../contract/index.ts';
import type { App } from '../server.ts';
import {
  as,
  cookieOf,
  expectProblem,
  inviteMember,
  mintPairingCode,
  PASSWORD,
  sessionCookie,
  signUpOwner,
  testServer,
} from './helpers.ts';

let clock: Date;
let app: App;
let setupCode: string;

beforeEach(async () => {
  clock = new Date('2026-09-28T10:00:00.000Z');
  ({ app } = await testServer({}, () => clock));
  setupCode = (await app.services.pairing.ensureSetupCode()) ?? '';
});

afterEach(async () => {
  await app.close();
});

function post(url: string, payload: object, cookie?: string, remoteAddress?: string) {
  return app.inject({ method: 'POST', url, payload, remoteAddress, ...as(cookie) });
}

const setUp = () => signUpOwner(app);
const mint = (cookie: string, kind: 'device' | 'invite') => mintPairingCode(app, cookie, kind);

async function invite(ownerCookie: string): Promise<string> {
  const response = await inviteMember(app, ownerCookie);
  expect(SessionResponse.parse(response.json()).account).toMatchObject({ role: 'member' });
  return cookieOf(response);
}

describe('first run', () => {
  it('needs setup until the Owner exists, then answers 404', async () => {
    const before = await app.inject('/api/setup');
    expect(SetupStatus.parse(before.json()).needsSetup).toBe(true);
    await setUp();
    expectProblem(await app.inject('/api/setup'), 404);
    expect(RootResponse.parse((await app.inject('/api')).json())._links.setup).toBeUndefined();
  });

  it('rejects a bad setup code with 401', async () => {
    const response = await post('/api/setup', {
      code: 'not-the-code',
      username: 'olga',
      password: PASSWORD,
      deviceName: 'Laptop',
    });
    expectProblem(response, 401);
    expect((await app.inject('/api/setup')).statusCode).toBe(200);
  });

  it('creates the Owner and signs the Device in with a strict cookie', async () => {
    const response = await post('/api/setup', {
      code: setupCode,
      username: '  olga ',
      password: PASSWORD,
      deviceName: 'Laptop',
    });
    expect(response.statusCode).toBe(201);
    const body = SessionResponse.parse(response.json());
    expect(body.account).toMatchObject({ username: 'olga', role: 'owner' });
    expect(sessionCookie(response)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
    });

    const session = await app.inject({
      url: '/api/session',
      ...as(sessionCookie(response)?.value),
    });
    expect(session.statusCode).toBe(200);
    expect(SessionResponse.parse(session.json())).toEqual(body);
  });

  it('answers 404 to a second setup, even with a code that would be good', async () => {
    await setUp();
    // An unspent setup code, as if one had survived in the database.
    const { code } = await app.services.pairing.mint('setup');
    const response = await post('/api/setup', {
      code,
      username: 'eve',
      password: PASSWORD,
      deviceName: 'Laptop',
    });
    expectProblem(response, 404);
  });

  it('validates the username and password shape', async () => {
    for (const [username, password] of [
      ['has space', PASSWORD],
      ['', PASSWORD],
      ['x'.repeat(65), PASSWORD],
      ['olga', 'short'],
    ]) {
      const response = await post('/api/setup', {
        code: setupCode,
        username,
        password,
        deviceName: 'Laptop',
      });
      expectProblem(response, 400);
    }
  });
});

describe('sessions', () => {
  it('signs in with a password; wrong username and wrong password are indistinguishable', async () => {
    await setUp();
    const good = await post('/api/session', {
      username: 'olga',
      password: PASSWORD,
      deviceName: 'Tablet',
    });
    expect(good.statusCode).toBe(201);
    expect(SessionResponse.parse(good.json()).device.name).toBe('Tablet');

    const wrongUser = await post('/api/session', {
      username: 'nobody',
      password: PASSWORD,
      deviceName: 'X',
    });
    const wrongPassword = await post('/api/session', {
      username: 'olga',
      password: 'wrong horse',
      deviceName: 'X',
    });
    expectProblem(wrongUser, 401);
    expectProblem(wrongPassword, 401);
    expect(wrongUser.body).toBe(wrongPassword.body);
    expect(sessionCookie(wrongUser)).toBeUndefined();
  });

  it('ends the Session on DELETE; the cookie stops working', async () => {
    const cookie = await setUp();
    const response = await app.inject({ method: 'DELETE', url: '/api/session', ...as(cookie) });
    expect(response.statusCode).toBe(204);
    expect(sessionCookie(response)?.value).toBe('');
    expectProblem(await app.inject({ url: '/api/session', ...as(cookie) }), 401);
  });

  it('treats an unknown or expired Session as none and clears the cookie', async () => {
    const unknown = await app.inject({ url: '/api/session', ...as('forged') });
    expectProblem(unknown, 401);
    expect(sessionCookie(unknown)?.value).toBe('');

    const cookie = await setUp();
    clock = new Date(clock.getTime() + 365 * 24 * 60 * 60 * 1000);
    expectProblem(await app.inject({ url: '/api/session', ...as(cookie) }), 401);
  });

  it('answers 429 after ten sign-in attempts a minute from one address', async () => {
    const attempt = (remoteAddress: string) =>
      post(
        '/api/session',
        { username: 'x', password: PASSWORD, deviceName: 'X' },
        undefined,
        remoteAddress
      );
    for (let i = 0; i < 10; i++) expect((await attempt('10.0.0.1')).statusCode).toBe(401);
    expectProblem(await attempt('10.0.0.1'), 429);
    expect((await attempt('10.0.0.2')).statusCode).toBe(401);
  });
});

describe('devices and pairing', () => {
  it('pairs a second Device with a device code; both are listed, one current', async () => {
    const laptop = await setUp();
    const code = await mint(laptop, 'device');
    // Later than the Laptop, since Devices are listed oldest first.
    clock = new Date(clock.getTime() + 1000);
    const paired = await post('/api/session', { code, deviceName: 'Phone' });
    expect(paired.statusCode).toBe(201);
    const phone = sessionCookie(paired)?.value ?? '';
    expect(SessionResponse.parse(paired.json()).account.username).toBe('olga');

    const list = DevicesResponse.parse(
      (await app.inject({ url: '/api/devices', ...as(phone) })).json()
    );
    expect(list._embedded.devices.map(({ name, current }) => ({ name, current }))).toEqual([
      { name: 'Laptop', current: false },
      { name: 'Phone', current: true },
    ]);
  });

  it('rejects a spent, an expired, or a wrong-kind code with the same 401', async () => {
    const laptop = await setUp();
    const code = await mint(laptop, 'device');
    expect((await post('/api/session', { code, deviceName: 'Phone' })).statusCode).toBe(201);
    const spent = expectProblem(await post('/api/session', { code, deviceName: 'Phone' }), 401);

    const late = await mint(laptop, 'device');
    clock = new Date(clock.getTime() + 10 * 60 * 1000);
    const expired = expectProblem(await post('/api/session', { code: late, deviceName: 'X' }), 401);

    const inviteCode = await mint(laptop, 'invite');
    const wrongKind = expectProblem(
      await post('/api/session', { code: inviteCode, deviceName: 'X' }),
      401
    );
    expect(new Set([spent.detail, expired.detail, wrongKind.detail]).size).toBe(1);
  });

  it('revokes a Device: its cookie stops working', async () => {
    const laptop = await setUp();
    const paired = await post('/api/session', {
      code: await mint(laptop, 'device'),
      deviceName: 'Phone',
    });
    const phone = sessionCookie(paired)?.value ?? '';
    const phoneId = SessionResponse.parse(paired.json()).device.id;

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/devices/${phoneId}`,
      ...as(laptop),
    });
    expect(revoke.statusCode).toBe(204);
    expect(sessionCookie(revoke)).toBeUndefined();
    expectProblem(await app.inject({ url: '/api/session', ...as(phone) }), 401);
    expect((await app.inject({ url: '/api/session', ...as(laptop) })).statusCode).toBe(200);
  });

  it("revokes the current Device, but not another Account's", async () => {
    const owner = await setUp();
    const member = await invite(owner);
    const memberId = SessionResponse.parse(
      (await app.inject({ url: '/api/session', ...as(member) })).json()
    ).device.id;
    const url = `/api/devices/${memberId}`;
    expectProblem(await app.inject({ method: 'DELETE', url, ...as(owner) }), 404);

    const self = await app.inject({ method: 'DELETE', url, ...as(member) });
    expect(self.statusCode).toBe(204);
    expect(sessionCookie(self)?.value).toBe('');
  });
});

describe('invites and passwords', () => {
  it('lists every Account to the Owner, with the links to manage each', async () => {
    const owner = await setUp();
    // Later than the Owner, since Accounts are listed oldest first.
    clock = new Date(clock.getTime() + 1000);
    await invite(owner);
    const response = await app.inject({ url: '/api/accounts', ...as(owner) });
    const list = AccountsResponse.parse(response.json())._embedded.accounts;
    expect(list.map(({ username, role }) => ({ username, role }))).toEqual([
      { username: 'olga', role: 'owner' },
      { username: 'max', role: 'member' },
    ]);
    const [, max] = list;
    expect(max?._links.password.href).toBe(`/api/accounts/${max?.id}/password`);
    const self = await app.inject({ url: max?._links.self.href ?? '', ...as(owner) });
    expect(Account.parse(self.json())).toEqual(max);
    expectProblem(
      await app.inject({ url: `/api/accounts/${crypto.randomUUID()}`, ...as(owner) }),
      404
    );
  });

  it('does not list Accounts to a member', async () => {
    const member = await invite(await setUp());
    expectProblem(await app.inject({ url: '/api/accounts', ...as(member) }), 403);
  });

  it('creates a member from an Invite; a member mints device codes but not Invites', async () => {
    const owner = await setUp();
    const member = await invite(owner);
    expectProblem(await post('/api/codes', { kind: 'invite' }, member), 403);
    expect(
      CodeResponse.parse((await post('/api/codes', { kind: 'device' }, member)).json())
    ).toMatchObject({
      kind: 'device',
      expiresAt: '2026-09-28T10:10:00.000Z',
    });
  });

  it('answers 409 to a taken username and keeps the Invite unspent', async () => {
    const owner = await setUp();
    const bad = await post('/api/accounts', {
      code: 'not-an-invite',
      username: 'olga',
      password: PASSWORD,
      deviceName: 'Phone',
    });
    expectProblem(bad, 401);
    const code = await mint(owner, 'invite');
    const taken = await post('/api/accounts', {
      code,
      username: 'olga',
      password: PASSWORD,
      deviceName: 'Phone',
    });
    expectProblem(taken, 409);
    const retry = await post('/api/accounts', {
      code,
      username: 'max',
      password: PASSWORD,
      deviceName: 'Phone',
    });
    expect(retry.statusCode).toBe(201);
  });

  it('lets the Owner reset a member password; the member signs in with the new one', async () => {
    const owner = await setUp();
    const member = await invite(owner);
    const memberId = SessionResponse.parse(
      (await app.inject({ url: '/api/session', ...as(member) })).json()
    ).account.id;
    const reset = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${memberId}/password`,
      payload: { password: 'new password' },
      ...as(owner),
    });
    expect(reset.statusCode).toBe(204);
    expect((await app.inject({ url: '/api/session', ...as(member) })).statusCode).toBe(200);
    const signIn = (password: string) =>
      post('/api/session', { username: 'max', password, deviceName: 'Tablet' });
    expectProblem(await signIn(PASSWORD), 401);
    expect((await signIn('new password')).statusCode).toBe(201);
  });

  it('keeps password reset to the Owner, and 404s an unknown Account', async () => {
    const owner = await setUp();
    const member = await invite(owner);
    const url = '/api/accounts/00000000-0000-4000-8000-000000000000/password';
    const payload = { password: 'new password' };
    expectProblem(await app.inject({ method: 'PUT', url, payload, ...as(member) }), 403);
    expectProblem(await app.inject({ method: 'PUT', url, payload }), 401);
    expectProblem(await app.inject({ method: 'PUT', url, payload, ...as(owner) }), 404);
  });
});
