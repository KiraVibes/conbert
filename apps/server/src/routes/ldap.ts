import type { FastifyInstance } from 'fastify';
import { isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  ldapImportRequestSchema,
  ldapSettingsRequestSchema,
  ldapTestRequestSchema,
  type GroupsResponse,
  type LdapGroupsResponse,
  type LdapSettingsResponse,
  type LdapTestResponse,
} from '@conbert/schemas';
import { first } from '../auth/ldap/client';
import {
  listUsers,
  membersOf,
  normalizeDn,
  openService,
  searchGroups,
} from '../auth/ldap/directory';
import { checkLdapLogin } from '../auth/ldap/login';
import {
  getLdapSettings,
  ldapReady,
  ldapSettingsDto,
  mergeWithStoredPassword,
  saveLdapSettings,
} from '../auth/ldap/settings';
import { syncLdap } from '../auth/ldap/sync';
import { requireAdmin } from '../auth/plugin';
import type { AppContext } from '../context';
import { groups } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { freeGroupName, insertGroup, listGroups, toGroupDto } from './groups';

/** More groups than this: ask the admin to search instead. */
const GROUP_LIST_LIMIT = 300;

const groupsQuery = z.object({ q: z.string().max(100).default('') });

/** Sign-in through LDAP – administrators only. */
export function registerLdapRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { preHandler: requireAdmin };

  const readySettings = () => {
    const settings = getLdapSettings(ctx.db, ctx.secrets);
    if (!ldapReady(settings)) throw new HttpError(400, 'LDAP_NOT_CONFIGURED');
    return settings;
  };

  app.get('/api/admin/ldap', admin, async (): Promise<LdapSettingsResponse> => ({
    settings: ldapSettingsDto(ctx.db),
  }));

  app.put('/api/admin/ldap', admin, async (request): Promise<LdapSettingsResponse> => {
    const body = ldapSettingsRequestSchema.parse(request.body);
    saveLdapSettings(ctx.db, ctx.secrets, body);
    request.log.info({ enabled: body.enabled, url: body.url }, 'ldap settings saved');
    return { settings: ldapSettingsDto(ctx.db) };
  });

  // Tries the settings from the form (not saved yet) – and optionally one sign-in.
  app.post('/api/admin/ldap/test', admin, async (request): Promise<LdapTestResponse> => {
    const body = ldapTestRequestSchema.parse(request.body);
    const settings = mergeWithStoredPassword(ctx.db, ctx.secrets, body.settings);
    if (!settings.url || !settings.userBase || !settings.userFilter) {
      throw new HttpError(400, 'LDAP_NOT_CONFIGURED');
    }
    const conn = await openService(ctx.ldap, settings);
    let userCount: number;
    let groupCount: number;
    try {
      userCount = (await listUsers(conn, settings)).length;
      groupCount = (await searchGroups(conn, settings)).length;
    } finally {
      await conn.close();
    }
    let login: LdapTestResponse['login'] = null;
    if (body.username) {
      const check = await checkLdapLogin(ctx, settings, body.username, body.password ?? '');
      const byDn = new Map(
        listGroups(ctx.db)
          .filter((g) => g.ldapDn)
          .map((g) => [g.ldapDn ?? '', g.name] as const),
      );
      login = {
        ok: check.ok,
        reason: check.ok ? null : check.reason,
        dn: check.entry?.dn ?? null,
        displayName: check.entry ? first(check.entry, settings.displayNameAttr) || null : null,
        // Imported groups by their Conbert name, the others by their DN.
        groups: check.groupDns.map((dn) => byDn.get(dn) ?? dn),
      };
    }
    return { users: userCount, groups: groupCount, login };
  });

  app.get('/api/admin/ldap/groups', admin, async (request): Promise<LdapGroupsResponse> => {
    const { q } = groupsQuery.parse(request.query);
    const settings = readySettings();
    const conn = await openService(ctx.ldap, settings);
    try {
      const entries = await searchGroups(conn, settings, q);
      const imported = new Set(
        ctx.db
          .select({ dn: groups.ldapDn })
          .from(groups)
          .where(isNotNull(groups.ldapDn))
          .all()
          .map((g) => g.dn),
      );
      const list = entries
        .map((e) => ({
          dn: e.dn,
          name: first(e, settings.groupNameAttr) || e.dn,
          members: membersOf(settings, e).size,
          imported: imported.has(normalizeDn(e.dn)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { groups: list.slice(0, GROUP_LIST_LIMIT), truncated: list.length > GROUP_LIST_LIMIT };
    } finally {
      await conn.close();
    }
  });

  // Takes the chosen directory groups over as Conbert groups (without functions yet).
  app.post('/api/admin/ldap/import', admin, async (request): Promise<GroupsResponse> => {
    const { dns } = ldapImportRequestSchema.parse(request.body);
    const settings = readySettings();
    const conn = await openService(ctx.ldap, settings);
    let found: { dn: string; name: string }[];
    try {
      const wanted = new Set(dns.map(normalizeDn));
      found = (await searchGroups(conn, settings))
        .filter((e) => wanted.has(normalizeDn(e.dn)))
        .map((e) => ({ dn: normalizeDn(e.dn), name: first(e, settings.groupNameAttr) || e.dn }));
    } finally {
      await conn.close();
    }
    if (found.length === 0) throw new HttpError(404, 'NOT_FOUND', 'no such LDAP group');
    ctx.db.transaction((tx) => {
      const existing = new Set(
        tx
          .select({ dn: groups.ldapDn })
          .from(groups)
          .where(isNotNull(groups.ldapDn))
          .all()
          .map((g) => g.dn),
      );
      for (const group of found) {
        if (existing.has(group.dn)) continue;
        insertGroup(tx, { name: freeGroupName(tx, group.name.slice(0, 64)), ldapDn: group.dn });
      }
    });
    // Fill the new groups with the accounts Conbert already knows.
    await syncLdap(ctx, request.log).catch(() => undefined);
    return { groups: listGroups(ctx.db).map((g) => toGroupDto(ctx.db, g)) };
  });

  app.post('/api/admin/ldap/sync', admin, async (request) => ({
    status: await syncLdap(ctx, request.log),
  }));
}
