import { Filter } from 'ldapts';
import { LDAP_USERNAME_PLACEHOLDER } from '@conbert/schemas';
import { HttpError } from '../../lib/http-error';
import {
  LdapInvalidCredentials,
  first,
  type LdapConnection,
  type LdapConnector,
  type LdapEntry,
} from './client';
import type { LdapSettings } from './settings';

/** DNs compare case-insensitively and ignore spaces around , and =. */
export function normalizeDn(dn: string): string {
  return dn
    .trim()
    .toLowerCase()
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*=\s*/g, '=');
}

/** RFC 4515 escaping, so a login name can never change the filter. */
export function escapeValue(value: string): string {
  return Filter.escape(value);
}

/** The user filter for one login name ('*' for "all users"). */
export function userFilterFor(settings: LdapSettings, username: string | '*'): string {
  const value = username === '*' ? '*' : escapeValue(username);
  return settings.userFilter.split(LDAP_USERNAME_PLACEHOLDER).join(value);
}

/** Connects and signs in with the service account (or anonymously without one). */
export async function openService(
  connect: LdapConnector,
  settings: LdapSettings,
): Promise<LdapConnection> {
  const conn = await connect(settings);
  if (settings.bindDn) {
    try {
      await conn.bind(settings.bindDn, settings.bindPassword);
    } catch (error) {
      await conn.close();
      if (error instanceof LdapInvalidCredentials) {
        throw new HttpError(502, 'LDAP_BIND_FAILED', settings.bindDn);
      }
      throw error;
    }
  }
  return conn;
}

export function userAttributes(settings: LdapSettings): string[] {
  return [settings.usernameAttr, settings.displayNameAttr];
}

/** Exactly one entry for this login name, or null (none or ambiguous). */
export async function findUser(
  conn: LdapConnection,
  settings: LdapSettings,
  username: string,
): Promise<LdapEntry | null> {
  const entries = await conn.search(settings.userBase, {
    filter: userFilterFor(settings, username),
    attributes: userAttributes(settings),
  });
  return entries.length === 1 ? (entries[0] ?? null) : null;
}

export async function listUsers(
  conn: LdapConnection,
  settings: LdapSettings,
): Promise<LdapEntry[]> {
  return conn.search(settings.userBase, {
    filter: userFilterFor(settings, '*'),
    attributes: userAttributes(settings),
  });
}

/** What a group stores for a member: the DN, or the plain user name for memberUid. */
export function memberValue(settings: LdapSettings, user: LdapEntry, username: string): string {
  return settings.memberAttr.toLowerCase() === 'memberuid'
    ? first(user, settings.usernameAttr) || username
    : user.dn;
}

function groupsBase(settings: LdapSettings): string {
  return settings.groupBase || settings.userBase;
}

/** DNs (normalized) of the groups a user is in. */
export async function groupDnsOf(
  conn: LdapConnection,
  settings: LdapSettings,
  user: LdapEntry,
  username: string,
): Promise<string[]> {
  if (!settings.groupFilter) return [];
  const value = escapeValue(memberValue(settings, user, username));
  const entries = await conn.search(groupsBase(settings), {
    filter: `(&${settings.groupFilter}(${settings.memberAttr}=${value}))`,
    attributes: [settings.groupNameAttr],
  });
  return entries.map((e) => normalizeDn(e.dn));
}

/** Groups in the directory, optionally only those whose name contains `query`. */
export async function searchGroups(
  conn: LdapConnection,
  settings: LdapSettings,
  query = '',
): Promise<LdapEntry[]> {
  if (!settings.groupFilter) return [];
  const byName = query.trim() ? `(${settings.groupNameAttr}=*${escapeValue(query.trim())}*)` : '';
  return conn.search(groupsBase(settings), {
    filter: byName ? `(&${settings.groupFilter}${byName})` : settings.groupFilter,
    attributes: [settings.groupNameAttr, settings.memberAttr],
  });
}

/** One group by its DN, with its members. null if it is gone. */
export async function readGroup(
  conn: LdapConnection,
  settings: LdapSettings,
  dn: string,
): Promise<LdapEntry | null> {
  const entries = await conn.search(dn, {
    scope: 'base',
    filter: '(objectClass=*)',
    attributes: [settings.groupNameAttr, settings.memberAttr],
  });
  return entries[0] ?? null;
}

/** Member values of a group entry, normalized (DNs or user names). */
export function membersOf(settings: LdapSettings, group: LdapEntry): Set<string> {
  return new Set((group.attrs[settings.memberAttr.toLowerCase()] ?? []).map(normalizeDn));
}
