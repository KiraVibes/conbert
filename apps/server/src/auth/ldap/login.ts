import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../../context';
import { users, type User } from '../../db/schema';
import { HttpError } from '../../lib/http-error';
import { applyAdminFromGroups, ldapGroupsByDn, syncMemberships } from '../permissions';
import { findUserById, findUserByName, insertUser } from '../users';
import { LdapInvalidCredentials, first, type LdapEntry } from './client';
import { findUser, groupDnsOf, normalizeDn, openService } from './directory';
import { getLdapSettings, ldapReady, type LdapSettings } from './settings';

/** Same rule as for reverse-proxy names: no spaces, nothing exotic. */
const LOGIN_NAME = /^[a-z0-9._@+-]{1,64}$/;

export type LdapCheck =
  | { ok: true; entry: LdapEntry; groupDns: string[] }
  | {
      ok: false;
      reason: 'notFound' | 'wrongPassword' | 'notInGroup';
      entry: LdapEntry | null;
      groupDns: string[];
    };

/**
 * Looks the user up with the service account, reads their groups and then
 * checks the password with a bind as the user (on a second connection, so
 * the service account keeps its rights).
 */
export async function checkLdapLogin(
  ctx: AppContext,
  settings: LdapSettings,
  username: string,
  password: string,
): Promise<LdapCheck> {
  const service = await openService(ctx.ldap, settings);
  let entry: LdapEntry | null;
  let groupDns: string[];
  try {
    entry = await findUser(service, settings, username);
    if (!entry) return { ok: false, reason: 'notFound', entry: null, groupDns: [] };
    groupDns = await groupDnsOf(service, settings, entry, username);
  } finally {
    await service.close();
  }

  // Never bind with an empty password: many servers treat it as anonymous = success.
  if (!password) return { ok: false, reason: 'wrongPassword', entry, groupDns };
  const asUser = await ctx.ldap(settings);
  try {
    await asUser.bind(entry.dn, password);
  } catch (error) {
    if (error instanceof LdapInvalidCredentials) {
      return { ok: false, reason: 'wrongPassword', entry, groupDns };
    }
    throw error;
  } finally {
    await asUser.close();
  }

  if (settings.onlyImportedGroups) {
    const imported = ldapGroupsByDn(ctx.db);
    if (!groupDns.some((dn) => imported.has(dn))) {
      return { ok: false, reason: 'notInGroup', entry, groupDns };
    }
  }
  return { ok: true, entry, groupDns };
}

/** Creates or updates the Conbert account of a directory user and syncs its groups. */
export function upsertLdapUser(
  ctx: AppContext,
  settings: LdapSettings,
  username: string,
  entry: LdapEntry,
  groupDns: string[],
): User {
  const displayName = first(entry, settings.displayNameAttr) || null;
  const dn = normalizeDn(entry.dn);
  return ctx.db.transaction((tx) => {
    const existing = findUserByName(tx, username);
    let id: string;
    if (existing) {
      id = existing.id;
      tx.update(users)
        .set({ ldapDn: dn, displayName, disabled: false, updatedAt: new Date() })
        .where(eq(users.id, id))
        .run();
    } else {
      id = insertUser(tx, {
        username,
        displayName: displayName ?? undefined,
        passwordHash: null,
        role: 'user',
        authSource: 'ldap',
        ldapDn: dn,
      }).id;
    }
    const byDn = ldapGroupsByDn(tx);
    syncMemberships(
      tx,
      id,
      'ldap',
      groupDns.flatMap((g) => byDn.get(g)?.id ?? []),
    );
    applyAdminFromGroups(tx, id);
    const user = findUserById(tx, id);
    if (!user) throw new Error('ldap user vanished');
    return user;
  });
}

/**
 * Sign-in with a directory account. Returns null for "wrong name or
 * password" (the caller answers INVALID_LOGIN). Local accounts with the same
 * name are never taken over.
 */
export async function ldapLogin(
  ctx: AppContext,
  username: string,
  password: string,
  log: FastifyBaseLogger,
): Promise<User | null> {
  const settings = getLdapSettings(ctx.db, ctx.secrets);
  if (!ldapReady(settings) || !LOGIN_NAME.test(username) || !password) return null;
  const existing = findUserByName(ctx.db, username);
  if (existing && existing.authSource !== 'ldap') return null;

  let check: LdapCheck;
  try {
    check = await checkLdapLogin(ctx, settings, username, password);
  } catch (error) {
    // The directory is down or misconfigured: say so instead of "wrong password".
    const httpError = error instanceof HttpError ? error : null;
    log.warn({ err: error }, 'ldap login failed');
    throw httpError ?? new HttpError(502, 'LDAP_UNREACHABLE');
  }
  if (!check.ok) {
    log.info({ user: username, reason: check.reason }, 'ldap login refused');
    return null;
  }
  return upsertLdapUser(ctx, settings, username, check.entry, check.groupDns);
}
