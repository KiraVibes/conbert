import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { groupResponseSchema, groupsResponseSchema } from '@conbert/schemas';
import { TEST_SETUP_CODE, testApp } from '../test/helpers';
import { parseProxyGroups } from './proxy-groups';

let app: FastifyInstance;
afterEach(() => app?.close());

const env = {
  CONBERT_AUTH_PROXY_HEADER: 'Remote-User',
  CONBERT_PROXY_GROUPS_HEADER: 'Remote-Groups',
  CONBERT_TRUSTED_PROXIES: '127.0.0.1',
};

const status = (user: string, groups?: string, remoteAddress?: string) =>
  app.inject({
    url: '/api/auth/status',
    headers: { 'remote-user': user, ...(groups !== undefined && { 'remote-groups': groups }) },
    ...(remoteAddress && { remoteAddress }),
  });

describe('groups from the reverse proxy', () => {
  it('splits Authelia and Authentik style lists', () => {
    expect(parseProxyGroups('Family, conbert-admins')).toEqual(['family', 'conbert-admins']);
    expect(parseProxyGroups('a|b c|')).toEqual(['a', 'b c']);
    expect(parseProxyGroups('')).toEqual([]);
  });

  it('puts proxy users into matching groups and follows changes', async () => {
    app = await testApp(env);
    await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: { 'remote-user': 'chef', 'remote-groups': 'admins' },
      payload: { mode: 'proxy', setupCode: TEST_SETUP_CODE },
    });
    const admin = { 'remote-user': 'chef', 'remote-groups': 'admins' };
    const everyone = await app.inject({
      method: 'PATCH',
      url: '/api/groups/everyone',
      headers: admin,
      payload: { permissions: { downloader: false } },
    });
    expect(everyone.statusCode).toBe(200);
    const created = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: admin,
      payload: { name: 'Familie', proxyName: 'Family', permissions: { downloader: true } },
    });
    const { group } = groupResponseSchema.parse(created.json());

    const without = (await status('gast')).json() as { user: { permissions: string[] } };
    expect(without.user.permissions).not.toContain('downloader');

    const withGroup = (await status('gast', 'users, family')).json() as {
      user: { id: string; permissions: string[] };
    };
    expect(withGroup.user.permissions).toContain('downloader');
    const list = groupsResponseSchema.parse(
      (await app.inject({ url: '/api/groups', headers: admin })).json(),
    );
    expect(list.groups.find((g) => g.id === group.id)?.members).toEqual([
      { userId: withGroup.user.id, username: 'gast', source: 'proxy' },
    ]);

    // Left the group at the proxy: the change counts right away.
    const left = (await status('gast', 'users')).json() as { user: { permissions: string[] } };
    expect(left.user.permissions).not.toContain('downloader');
  });

  it('ignores the groups header from addresses that are not the proxy', async () => {
    app = await testApp(env);
    await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: { 'remote-user': 'chef' },
      payload: { mode: 'proxy', setupCode: TEST_SETUP_CODE },
    });
    const spoofed = await status('chef', 'admins', '192.168.1.50');
    expect((spoofed.json() as { user: unknown }).user).toBeNull();
  });
});
