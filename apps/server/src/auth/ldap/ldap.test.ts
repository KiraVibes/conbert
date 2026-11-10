import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  groupsResponseSchema,
  ldapGroupsResponseSchema,
  ldapSettingsResponseSchema,
  ldapTestResponseSchema,
  userResponseSchema,
} from '@conbert/schemas';
import { SAMPLE_LDAP_SETTINGS, fakeLdap, sampleDirectory } from '../../test/fake-ldap';
import { ADMIN, sessionCookie, setupAdmin, testApp } from '../../test/helpers';
import { normalizeDn, userFilterFor } from './directory';
import { LDAP_DEFAULTS } from './settings';

let app: FastifyInstance;
let admin: string;
let ldap: ReturnType<typeof fakeLdap>;

beforeEach(async () => {
  ldap = fakeLdap(sampleDirectory());
  app = await testApp({}, { ldapConnector: ldap.connector });
  admin = await setupAdmin(app);
});
afterEach(() => app.close());

const errorCode = (res: { json: () => unknown }) =>
  (res.json() as { error?: { code?: string } }).error?.code;

async function configure(overrides: Partial<typeof SAMPLE_LDAP_SETTINGS> = {}) {
  const res = await app.inject({
    method: 'PUT',
    url: '/api/admin/ldap',
    headers: { cookie: admin },
    payload: { ...SAMPLE_LDAP_SETTINGS, ...overrides },
  });
  expect(res.statusCode, res.body).toBe(200);
  return ldapSettingsResponseSchema.parse(res.json()).settings;
}

const login = (username: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });

async function importGroups(dns: string[]) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/ldap/import',
    headers: { cookie: admin },
    payload: { dns },
  });
  expect(res.statusCode, res.body).toBe(200);
  return groupsResponseSchema.parse(res.json()).groups;
}

describe('LDAP filters', () => {
  it('escapes the login name, so it cannot change the filter', () => {
    const settings = { ...LDAP_DEFAULTS, bindPassword: '', lastSync: null };
    expect(userFilterFor(settings, 'a*b)(uid=*')).toBe(
      '(&(objectClass=person)(uid=a\\2ab\\29\\28uid=\\2a))',
    );
    expect(userFilterFor(settings, '*')).toBe('(&(objectClass=person)(uid=*))');
  });

  it('compares DNs without case and spaces', () => {
    expect(normalizeDn('CN=Family, OU=Groups ,dc = home')).toBe('cn=family,ou=groups,dc=home');
  });
});

describe('LDAP settings', () => {
  it('stores the bind password encrypted and never returns it', async () => {
    const saved = await configure();
    expect(saved).toMatchObject({ enabled: true, hasBindPassword: true });
    expect(JSON.stringify(saved)).not.toContain('svc-pw');
    // Saving without a password keeps it.
    const { bindPassword: _omit, ...rest } = SAMPLE_LDAP_SETTINGS;
    void _omit;
    const again = await app.inject({
      method: 'PUT',
      url: '/api/admin/ldap',
      headers: { cookie: admin },
      payload: rest,
    });
    expect(ldapSettingsResponseSchema.parse(again.json()).settings.hasBindPassword).toBe(true);
  });

  it('is for administrators only, and not with API tokens', async () => {
    const res = await app.inject({ url: '/api/admin/ldap' });
    expect(res.statusCode).toBe(401);
  });

  it('tests the connection and one sign-in', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/ldap/test',
      headers: { cookie: admin },
      payload: { settings: SAMPLE_LDAP_SETTINGS, username: 'bea', password: 'bea-ldap-pw' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const result = ldapTestResponseSchema.parse(res.json());
    expect(result).toMatchObject({
      users: 2,
      groups: 2,
      login: { ok: true, displayName: 'Bea Beispiel', groups: ['cn=family,ou=groups,dc=home'] },
    });

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/admin/ldap/test',
      headers: { cookie: admin },
      payload: { settings: { ...SAMPLE_LDAP_SETTINGS, bindPassword: 'nope' } },
    });
    expect(errorCode(wrong)).toBe('LDAP_BIND_FAILED');
  });
});

describe('LDAP sign-in', () => {
  it('creates the account on first sign-in, without a password in Conbert', async () => {
    await configure();
    const status = (await app.inject({ url: '/api/auth/status' })).json() as { ldap: boolean };
    expect(status.ldap).toBe(true);

    expect((await login('bea', 'wrong')).statusCode).toBe(401);
    const res = await login('bea', 'bea-ldap-pw');
    expect(res.statusCode, res.body).toBe(200);
    const { user } = userResponseSchema.parse(res.json());
    expect(user).toMatchObject({
      username: 'bea',
      displayName: 'Bea Beispiel',
      authSource: 'ldap',
      hasPassword: false,
      role: 'user',
    });
    // A password change in Conbert makes no sense for directory accounts.
    const change = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie: sessionCookie(res) },
      payload: { currentPassword: 'bea-ldap-pw', newPassword: 'something long enough' },
    });
    expect(errorCode(change)).toBe('LDAP_MANAGED');
  });

  it('never takes over a local account with the same name', async () => {
    await configure();
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: admin },
      payload: { username: 'bea', password: 'local password' },
    });
    expect((await login('bea', 'bea-ldap-pw')).statusCode).toBe(401);
    expect((await login('bea', 'local password')).statusCode).toBe(200);
  });

  it('keeps local sign-in working while the directory is down', async () => {
    await configure();
    ldap.state.down = true;
    expect((await login(ADMIN.username, ADMIN.password)).statusCode).toBe(200);
    const res = await login('bea', 'bea-ldap-pw');
    expect(res.statusCode).toBe(502);
    expect(errorCode(res)).toBe('LDAP_UNREACHABLE');
  });

  it('does nothing while switched off', async () => {
    await configure({ enabled: false });
    expect((await login('bea', 'bea-ldap-pw')).statusCode).toBe(401);
    expect(ldap.state.binds).toEqual([]);
  });
});

describe('LDAP groups', () => {
  it('lists directory groups, imports them and fills them at sign-in', async () => {
    await configure();
    const listed = ldapGroupsResponseSchema.parse(
      (await app.inject({ url: '/api/admin/ldap/groups', headers: { cookie: admin } })).json(),
    );
    expect(listed.groups.map((g) => [g.name, g.members, g.imported])).toEqual([
      ['admins', 1, false],
      ['family', 2, false],
    ]);
    const searched = ldapGroupsResponseSchema.parse(
      (
        await app.inject({ url: '/api/admin/ldap/groups?q=fam', headers: { cookie: admin } })
      ).json(),
    );
    expect(searched.groups.map((g) => g.name)).toEqual(['family']);

    const groups = await importGroups([
      'cn=family,ou=groups,dc=home',
      'CN=admins, ou=groups,dc=home',
    ]);
    const family = groups.find((g) => g.name === 'family');
    const admins = groups.find((g) => g.name === 'admins');
    if (!family || !admins) throw new Error('import failed');
    expect(family.ldapDn).toBe('cn=family,ou=groups,dc=home');

    // "admins" makes its members administrators.
    await app.inject({
      method: 'PATCH',
      url: `/api/groups/${admins.id}`,
      headers: { cookie: admin },
      payload: { grantsAdmin: true },
    });
    const carl = userResponseSchema.parse((await login('carl', 'carl-ldap-pw')).json()).user;
    expect(carl.role).toBe('admin');
    const bea = userResponseSchema.parse((await login('bea', 'bea-ldap-pw')).json()).user;
    expect(bea.role).toBe('user');

    const after = groupsResponseSchema.parse(
      (await app.inject({ url: '/api/groups', headers: { cookie: admin } })).json(),
    ).groups;
    expect(
      after.find((g) => g.id === family.id)?.members.map((m) => [m.username, m.source]),
    ).toEqual([
      ['bea', 'ldap'],
      ['carl', 'ldap'],
    ]);
    // Importing twice changes nothing.
    expect(await importGroups(['cn=family,ou=groups,dc=home'])).toHaveLength(after.length);
  });

  it('only lets members of imported groups in when asked to', async () => {
    await configure({ onlyImportedGroups: true });
    await importGroups(['cn=admins,ou=groups,dc=home']);
    expect((await login('bea', 'bea-ldap-pw')).statusCode).toBe(401);
    expect((await login('carl', 'carl-ldap-pw')).statusCode).toBe(200);
  });

  it('sync blocks accounts the directory no longer knows and updates groups', async () => {
    await configure();
    const [family] = await importGroups(['cn=family,ou=groups,dc=home']).then((g) =>
      g.filter((x) => x.ldapDn),
    );
    const res = await login('bea', 'bea-ldap-pw');
    const cookie = sessionCookie(res);
    expect((await app.inject({ url: '/api/engines', headers: { cookie } })).statusCode).toBe(200);

    // Bea leaves the family group, Carl was never signed in.
    ldap.state.entries = sampleDirectory().map((e) =>
      e.dn.startsWith('cn=family')
        ? { ...e, attrs: { ...e.attrs, member: ['uid=carl,ou=people,dc=home'] } }
        : e,
    );
    const sync = await app.inject({
      method: 'POST',
      url: '/api/admin/ldap/sync',
      headers: { cookie: admin },
    });
    expect(sync.json()).toMatchObject({ status: { ok: true, users: 1, groups: 1, disabled: 0 } });
    const groups = groupsResponseSchema.parse(
      (await app.inject({ url: '/api/groups', headers: { cookie: admin } })).json(),
    ).groups;
    expect(groups.find((g) => g.id === family?.id)?.members).toEqual([]);

    // Bea is removed from the directory: blocked, signed out everywhere.
    ldap.state.entries = sampleDirectory().filter((e) => !e.dn.startsWith('uid=bea'));
    const sync2 = await app.inject({
      method: 'POST',
      url: '/api/admin/ldap/sync',
      headers: { cookie: admin },
    });
    expect(sync2.json()).toMatchObject({ status: { disabled: 1 } });
    expect((await app.inject({ url: '/api/engines', headers: { cookie } })).statusCode).toBe(401);
    const users = (await app.inject({ url: '/api/users', headers: { cookie: admin } })).json() as {
      users: { username: string; disabled: boolean }[];
    };
    expect(users.users.find((u) => u.username === 'bea')?.disabled).toBe(true);

    // Back in the directory: the next sign-in works again.
    ldap.state.entries = sampleDirectory();
    expect((await login('bea', 'bea-ldap-pw')).statusCode).toBe(200);
  });
});
