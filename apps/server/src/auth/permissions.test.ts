import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  FEATURES,
  groupResponseSchema,
  groupsResponseSchema,
  userResponseSchema,
} from '@conbert/schemas';
import { sessionCookie, setupAdmin, testApp } from '../test/helpers';
import { featureForPath, groupAllows } from './permissions';

let app: FastifyInstance;
let admin: string;

beforeEach(async () => {
  app = await testApp();
  admin = await setupAdmin(app);
});
afterEach(() => app.close());

const errorCode = (res: { json: () => unknown }) =>
  (res.json() as { error?: { code?: string } }).error?.code;

async function newUser(username = 'bea') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie: admin },
    payload: { username, password: 'long enough pw' },
  });
  const { user } = userResponseSchema.parse(res.json());
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: 'long enough pw' },
  });
  return { user, cookie: sessionCookie(login) };
}

async function groups() {
  return groupsResponseSchema.parse(
    (await app.inject({ url: '/api/groups', headers: { cookie: admin } })).json(),
  ).groups;
}

async function everyoneGroup() {
  const group = (await groups()).find((g) => g.builtin === 'everyone');
  if (!group) throw new Error('no everyone group');
  return group;
}

async function makeGroup(name: string, permissions: object, userIds: string[]) {
  const created = await app.inject({
    method: 'POST',
    url: '/api/groups',
    headers: { cookie: admin },
    payload: { name, permissions },
  });
  expect(created.statusCode).toBe(201);
  const { group } = groupResponseSchema.parse(created.json());
  const members = await app.inject({
    method: 'PUT',
    url: `/api/groups/${group.id}/members`,
    headers: { cookie: admin },
    payload: { userIds },
  });
  return groupResponseSchema.parse(members.json()).group;
}

async function patchGroup(id: string, payload: object) {
  return app.inject({
    method: 'PATCH',
    url: `/api/groups/${id}`,
    headers: { cookie: admin },
    payload,
  });
}

describe('permission rules', () => {
  it('maps API paths to functions', () => {
    expect(featureForPath('/api/downloader/jobs')).toBe('downloader');
    expect(featureForPath('/api/booru')).toBe('booru');
    expect(featureForPath('/api/subscriptions/1')).toBe('booru');
    expect(featureForPath('/api/jobs')).toBe('serverConvert');
    expect(featureForPath('/api/upload')).toBeNull();
    expect(featureForPath('/api/jobsx')).toBeNull();
  });

  it('"everyone" allows all, other groups block what is switched off', () => {
    expect(groupAllows({ builtin: 'everyone', permissions: {} }, 'booru')).toBe(true);
    expect(groupAllows({ builtin: 'everyone', permissions: { booru: false } }, 'booru')).toBe(true);
    expect(groupAllows({ builtin: null, permissions: {} }, 'booru')).toBe(true);
    expect(groupAllows({ builtin: null, permissions: { booru: true } }, 'booru')).toBe(true);
    expect(groupAllows({ builtin: null, permissions: { booru: false } }, 'booru')).toBe(false);
  });
});

describe('groups and functions', () => {
  it('existing users keep everything after the update', async () => {
    const { cookie } = await newUser();
    const status = (await app.inject({ url: '/api/auth/status', headers: { cookie } })).json() as {
      user: { permissions: string[] };
    };
    expect(status.user.permissions).toEqual([...FEATURES]);
    const list = await groups();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ builtin: 'everyone', members: [] });
  });

  it('a group blocks for its members, a block wins, the user override beats both', async () => {
    const { user, cookie } = await newUser();
    const group = await makeGroup('Kinder', { downloader: false }, [user.id]);
    const open = await makeGroup('Downloader', {}, [user.id]);
    expect(open.members).toEqual([{ userId: user.id, username: 'bea', source: 'manual' }]);

    // "Downloader" leaves it open, "Kinder" blocks it: the block wins.
    const blocked = await app.inject({ url: '/api/downloader/jobs', headers: { cookie } });
    expect(blocked.statusCode).toBe(403);
    expect(errorCode(blocked)).toBe('FEATURE_FORBIDDEN');
    // Other functions stay open, admins may always do everything.
    expect((await app.inject({ url: '/api/booru/sites', headers: { cookie } })).statusCode).toBe(
      200,
    );
    expect(
      (await app.inject({ url: '/api/downloader/jobs', headers: { cookie: admin } })).statusCode,
    ).toBe(200);

    // The user's own "allow" beats the group.
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/users/${user.id}`,
      headers: { cookie: admin },
      payload: { permissionOverrides: { downloader: 'allow' } },
    });
    const dto = userResponseSchema.parse(patched.json()).user;
    expect(dto.permissions).toContain('downloader');
    expect(dto.groups?.map((g) => g.name).sort()).toEqual(['Downloader', 'Kinder']);
    expect(
      (await app.inject({ url: '/api/downloader/jobs', headers: { cookie } })).statusCode,
    ).toBe(200);
    expect(group.permissions).toEqual({ downloader: false });
  });

  it('applies to API tokens as well', async () => {
    const { user, cookie } = await newUser();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie },
      payload: { name: 'script', expiresInDays: null },
    });
    const { secret } = res.json() as { secret: string };
    const group = await makeGroup('Ohne Booru', { booru: false }, [user.id]);
    const blocked = await app.inject({
      url: '/api/booru/sites',
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(blocked.statusCode).toBe(403);
    expect(errorCode(blocked)).toBe('FEATURE_FORBIDDEN');
    // Without the function, no new tokens either.
    await patchGroup(group.id, { permissions: { booru: false, apiTokens: false } });
    expect((await app.inject({ url: '/api/tokens', headers: { cookie } })).statusCode).toBe(403);
  });

  it('protects the built-in group and unique names', async () => {
    const everyone = await everyoneGroup();
    expect(errorCode(await patchGroup(everyone.id, { name: 'x' }))).toBe('GROUP_BUILTIN');
    // "Everyone" always allows everything.
    expect(errorCode(await patchGroup(everyone.id, { permissions: { booru: false } }))).toBe(
      'GROUP_BUILTIN',
    );
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${everyone.id}`,
      headers: { cookie: admin },
    });
    expect(errorCode(del)).toBe('GROUP_BUILTIN');
    const make = (name: string) =>
      app.inject({
        method: 'POST',
        url: '/api/groups',
        headers: { cookie: admin },
        payload: { name },
      });
    expect((await make('Team')).statusCode).toBe(201);
    expect(errorCode(await make('team'))).toBe('GROUP_NAME_TAKEN');
  });

  it('is for administrators only', async () => {
    const { cookie } = await newUser();
    expect((await app.inject({ url: '/api/groups', headers: { cookie } })).statusCode).toBe(403);
  });
});
