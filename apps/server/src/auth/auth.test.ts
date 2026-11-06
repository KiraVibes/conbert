import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { authStatusResponseSchema } from '@conbert/schemas';
import { ADMIN, TEST_SETUP_CODE, sessionCookie, setupAdmin, testApp } from '../test/helpers';
import { hashPassword, verifyPassword } from './password';
import { FailureLimiter } from './rate-limit';
import { generateSetupCode, setupCodeMatches } from './setup';
import { createProxyMatcher } from './trusted-proxies';

let app: FastifyInstance;
afterEach(() => app?.close());

const errorCode = (res: { json: () => unknown }) =>
  (res.json() as { error?: { code?: string } }).error?.code;

describe('first-start setup', () => {
  it('reports that setup is required and blocks the rest of the API', async () => {
    app = await testApp();
    const status = authStatusResponseSchema.parse(
      (await app.inject({ url: '/api/auth/status' })).json(),
    );
    expect(status).toMatchObject({ setupRequired: true, user: null, authMode: 'local' });
    const engines = await app.inject({ url: '/api/engines' });
    expect(engines.statusCode).toBe(403);
    expect(errorCode(engines)).toBe('SETUP_REQUIRED');
  });

  it('rejects a wrong setup code', async () => {
    app = await testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { mode: 'local', setupCode: 'NOPE-NOPE', ...ADMIN },
    });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('INVALID_SETUP_CODE');
  });

  it('creates the admin, signs them in and can only run once', async () => {
    app = await testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { mode: 'local', setupCode: 'test code', ...ADMIN, displayName: 'Chefin' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { username: 'admin', role: 'admin' } });
    const cookie = res.cookies.find((c) => c.name === 'conbert_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: {
        mode: 'local',
        setupCode: TEST_SETUP_CODE,
        username: 'x2',
        password: 'long enough pw',
      },
    });
    expect(errorCode(again)).toBe('SETUP_DONE');
  });

  it('explains weak passwords and invalid user names', async () => {
    app = await testApp();
    const weak = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { mode: 'local', setupCode: TEST_SETUP_CODE, username: 'anna', password: 'short' },
    });
    expect(errorCode(weak)).toBe('WEAK_PASSWORD');
    const badName = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: {
        mode: 'local',
        setupCode: TEST_SETUP_CODE,
        username: 'Ä!',
        password: 'long enough pw',
      },
    });
    expect(errorCode(badName)).toBe('INVALID_USERNAME');
  });
});

describe('login and sessions', () => {
  it('signs in with the right password only', async () => {
    app = await testApp();
    await setupAdmin(app);
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong password!' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(errorCode(wrong)).toBe('INVALID_LOGIN');
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', password: 'whatever123' },
    });
    expect(errorCode(unknown)).toBe('INVALID_LOGIN');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ADMIN', password: ADMIN.password },
    });
    const cookie = sessionCookie(ok);
    const status = await app.inject({ url: '/api/auth/status', headers: { cookie } });
    expect(status.json()).toMatchObject({ setupRequired: false, user: { username: 'admin' } });
  });

  it('slows down password guessing', async () => {
    app = await testApp();
    await setupAdmin(app);
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'wrong password!' },
      });
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('logout ends the session', async () => {
    app = await testApp();
    const cookie = await setupAdmin(app);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    const res = await app.inject({ url: '/api/engines', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });

  it('changing the password signs out other devices but keeps this one', async () => {
    app = await testApp();
    const here = await setupAdmin(app);
    const other = sessionCookie(
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN }),
    );
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: here },
      payload: { currentPassword: 'nope', newPassword: 'another long pw' },
    });
    expect(errorCode(wrong)).toBe('WRONG_PASSWORD');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: here },
      payload: { currentPassword: ADMIN.password, newPassword: 'another long pw' },
    });
    expect(ok.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/engines', headers: { cookie: here } })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ url: '/api/engines', headers: { cookie: other } })).statusCode).toBe(
      401,
    );
  });

  it('blocks state-changing requests from other websites', async () => {
    app = await testApp();
    const cookie = await setupAdmin(app);
    const evil = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie, origin: 'https://evil.example' },
      payload: { settings: { theme: 'dark' } },
    });
    expect(evil.statusCode).toBe(403);
    expect(errorCode(evil)).toBe('CROSS_ORIGIN');
    const same = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie, origin: 'http://localhost:80', host: 'localhost:80' },
      payload: { settings: { theme: 'dark' } },
    });
    expect(same.statusCode).toBe(200);
  });
});

describe('user management', () => {
  async function createUser(cookie: string, username: string, role = 'user') {
    return app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { username, password: 'a long password', role },
    });
  }

  it('lets admins create users and refuses duplicates', async () => {
    app = await testApp();
    const cookie = await setupAdmin(app);
    const created = await createUser(cookie, 'bea');
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      user: { username: 'bea', role: 'user', hasPassword: true },
    });
    expect(errorCode(await createUser(cookie, 'BEA'))).toBe('USERNAME_TAKEN');
    const list = await app.inject({ url: '/api/users', headers: { cookie } });
    expect((list.json() as { users: unknown[] }).users).toHaveLength(2);
  });

  it('keeps user management away from normal users', async () => {
    app = await testApp();
    const admin = await setupAdmin(app);
    await createUser(admin, 'bea');
    const bea = sessionCookie(
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'bea', password: 'a long password' },
      }),
    );
    const res = await app.inject({ url: '/api/users', headers: { cookie: bea } });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('never removes the last administrator', async () => {
    app = await testApp();
    const cookie = await setupAdmin(app);
    const me = (await app.inject({ url: '/api/auth/status', headers: { cookie } })).json() as {
      user: { id: string };
    };
    const demote = await app.inject({
      method: 'PATCH',
      url: `/api/users/${me.user.id}`,
      headers: { cookie },
      payload: { role: 'user' },
    });
    expect(errorCode(demote)).toBe('LAST_ADMIN');
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/users/${me.user.id}`,
      headers: { cookie },
    });
    expect(errorCode(del)).toBe('LAST_ADMIN');
  });

  it('a password reset by the admin signs the user out', async () => {
    app = await testApp();
    const admin = await setupAdmin(app);
    const bea = (await createUser(admin, 'bea')).json() as { user: { id: string } };
    const beaCookie = sessionCookie(
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'bea', password: 'a long password' },
      }),
    );
    await app.inject({
      method: 'PATCH',
      url: `/api/users/${bea.user.id}`,
      headers: { cookie: admin },
      payload: { password: 'brand new password' },
    });
    expect(
      (await app.inject({ url: '/api/engines', headers: { cookie: beaCookie } })).statusCode,
    ).toBe(401);
  });
});

describe('per-user settings', () => {
  it('stores settings per user', async () => {
    app = await testApp();
    const admin = await setupAdmin(app);
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: admin },
      payload: { username: 'bea', password: 'a long password' },
    });
    const bea = sessionCookie(
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'bea', password: 'a long password' },
      }),
    );
    expect((await app.inject({ url: '/api/settings', headers: { cookie: admin } })).json()).toEqual(
      {
        settings: {},
      },
    );
    await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie: admin },
      payload: { settings: { theme: 'dark', expertMode: true } },
    });
    expect((await app.inject({ url: '/api/settings', headers: { cookie: admin } })).json()).toEqual(
      {
        settings: { theme: 'dark', expertMode: true },
      },
    );
    expect((await app.inject({ url: '/api/settings', headers: { cookie: bea } })).json()).toEqual({
      settings: {},
    });
  });
});

describe('reverse-proxy login', () => {
  const env = { CONBERT_AUTH_PROXY_HEADER: 'Remote-User', CONBERT_TRUSTED_PROXIES: '127.0.0.1' };

  it('sets up with the proxy user as admin and creates further users on the fly', async () => {
    app = await testApp(env);
    const status = await app.inject({
      url: '/api/auth/status',
      headers: { 'remote-user': 'chef' },
    });
    expect(status.json()).toMatchObject({ proxyAvailable: true, proxyUser: 'chef' });

    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: { 'remote-user': 'chef' },
      payload: { mode: 'proxy', setupCode: TEST_SETUP_CODE },
    });
    expect(setup.json()).toMatchObject({
      user: { username: 'chef', role: 'admin', hasPassword: false },
    });

    const other = await app.inject({
      url: '/api/auth/status',
      headers: { 'remote-user': 'gast@example.org' },
    });
    expect(other.json()).toMatchObject({
      authMode: 'proxy',
      user: { username: 'gast@example.org', role: 'user' },
    });
  });

  it('ignores the header from addresses that are not the proxy', async () => {
    app = await testApp(env);
    await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: { 'remote-user': 'chef' },
      payload: { mode: 'proxy', setupCode: TEST_SETUP_CODE },
    });
    const spoofed = await app.inject({
      url: '/api/engines',
      headers: { 'remote-user': 'chef' },
      remoteAddress: '192.168.1.50',
    });
    expect(spoofed.statusCode).toBe(401);
  });

  it('refuses to start with a header but no trusted proxies', async () => {
    await expect(testApp({ CONBERT_AUTH_PROXY_HEADER: 'Remote-User' })).rejects.toThrow(
      /CONBERT_TRUSTED_PROXIES/,
    );
  });
});

describe('building blocks', () => {
  it('hashes passwords with Argon2id and verifies them', async () => {
    const hash = await hashPassword('geheimes passwort');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword('geheimes passwort', hash)).toBe(true);
    expect(await verifyPassword('falsches passwort', hash)).toBe(false);
    expect(await verifyPassword('x', 'not a hash')).toBe(false);
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('generates readable setup codes and compares them leniently', () => {
    const code = generateSetupCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(setupCodeMatches('K7QM-3XRP', 'k7qm 3xrp')).toBe(true);
    expect(setupCodeMatches('K7QM-3XRP', 'K7QM-3XRQ')).toBe(false);
  });

  it('matches proxy addresses incl. CIDR ranges and IPv4-mapped IPv6', () => {
    const trusted = createProxyMatcher(['10.0.0.0/8', '192.168.1.2', 'fd00::/8']);
    expect(trusted('10.20.30.40')).toBe(true);
    expect(trusted('::ffff:10.1.1.1')).toBe(true);
    expect(trusted('192.168.1.2')).toBe(true);
    expect(trusted('192.168.1.3')).toBe(false);
    expect(trusted('fd12::1')).toBe(true);
    expect(trusted(undefined)).toBe(false);
    expect(() => createProxyMatcher(['not-an-ip'])).toThrow();
  });

  it('limits failures within a time window', () => {
    const limiter = new FailureLimiter(3, 1000);
    limiter.fail('k', 0);
    limiter.fail('k', 10);
    expect(limiter.retryAfter('k', 20)).toBe(0);
    limiter.fail('k', 20);
    expect(limiter.retryAfter('k', 30)).toBeGreaterThan(0);
    expect(limiter.retryAfter('k', 1500)).toBe(0);
  });
});
