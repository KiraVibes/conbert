import { eq, isNotNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { LdapSyncStatus } from '@conbert/schemas';
import type { AppContext } from '../../context';
import { groups, users } from '../../db/schema';
import { API_ERROR_KEYS, HttpError } from '../../lib/http-error';
import { applyAdminFromGroups, syncMemberships } from '../permissions';
import { deleteUserSessions } from '../sessions';
import { first, type LdapConnection } from './client';
import { listUsers, membersOf, normalizeDn, openService, readGroup } from './directory';
import { getLdapSettings, ldapReady, setLastSync, type LdapSettings } from './settings';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Member sets of all imported groups: group id → member values. Missing groups are left out. */
async function importedGroupMembers(
  conn: LdapConnection,
  settings: LdapSettings,
  rows: { id: string; ldapDn: string | null }[],
  log: FastifyBaseLogger,
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.ldapDn) continue;
    const entry = await readGroup(conn, settings, row.ldapDn);
    if (entry) result.set(row.id, membersOf(settings, entry));
    else {
      log.warn({ group: row.ldapDn }, 'ldap group no longer exists');
      result.set(row.id, new Set());
    }
  }
  return result;
}

/**
 * Brings all LDAP accounts in line with the directory: group memberships,
 * display names, and accounts the directory no longer knows are blocked
 * (their sessions end right away). Comes back blocked accounts in again.
 */
export async function syncLdap(ctx: AppContext, log: FastifyBaseLogger): Promise<LdapSyncStatus> {
  const settings = getLdapSettings(ctx.db, ctx.secrets);
  if (!ldapReady(settings)) throw new HttpError(400, 'LDAP_NOT_CONFIGURED');
  const at = new Date().toISOString();
  let status: LdapSyncStatus;
  try {
    const conn = await openService(ctx.ldap, settings);
    try {
      const directory = await listUsers(conn, settings);
      const byName = new Map(
        directory.map((e) => [first(e, settings.usernameAttr).toLowerCase(), e] as const),
      );
      const imported = ctx.db
        .select({ id: groups.id, ldapDn: groups.ldapDn })
        .from(groups)
        .where(isNotNull(groups.ldapDn))
        .all();
      const members = await importedGroupMembers(conn, settings, imported, log);
      const accounts = ctx.db.select().from(users).where(eq(users.authSource, 'ldap')).all();
      let disabled = 0;
      ctx.db.transaction((tx) => {
        for (const account of accounts) {
          const entry = byName.get(account.username);
          if (!entry) {
            if (!account.disabled) {
              tx.update(users)
                .set({ disabled: true, updatedAt: new Date() })
                .where(eq(users.id, account.id))
                .run();
              deleteUserSessions(tx, account.id);
            }
            disabled++;
            continue;
          }
          const dn = normalizeDn(entry.dn);
          const value = settings.memberAttr.toLowerCase() === 'memberuid' ? account.username : dn;
          const groupIds = [...members].filter(([, set]) => set.has(value)).map(([id]) => id);
          let blocked = false;
          if (settings.onlyImportedGroups && groupIds.length === 0) {
            // Left all imported groups: no more sign-in.
            blocked = true;
            disabled++;
            if (!account.disabled) deleteUserSessions(tx, account.id);
          }
          tx.update(users)
            .set({
              ldapDn: dn,
              displayName: first(entry, settings.displayNameAttr) || account.displayName,
              disabled: blocked,
              updatedAt: new Date(),
            })
            .where(eq(users.id, account.id))
            .run();
          syncMemberships(tx, account.id, 'ldap', groupIds);
          applyAdminFromGroups(tx, account.id);
        }
      });
      status = {
        at,
        ok: true,
        users: accounts.length,
        groups: imported.length,
        disabled,
        errorKey: null,
      };
    } finally {
      await conn.close();
    }
  } catch (error) {
    log.warn({ err: error }, 'ldap sync failed');
    const code = error instanceof HttpError ? error.code : 'LDAP_UNREACHABLE';
    status = { at, ok: false, users: 0, groups: 0, disabled: 0, errorKey: API_ERROR_KEYS[code] };
    setLastSync(ctx.db, status);
    throw error instanceof HttpError ? error : new HttpError(502, 'LDAP_UNREACHABLE');
  }
  setLastSync(ctx.db, status);
  log.info(status, 'ldap sync done');
  return status;
}

/** Checks every few minutes whether an automatic sync is due. */
export function startLdapScheduler(ctx: AppContext, log: FastifyBaseLogger): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    const settings = getLdapSettings(ctx.db, ctx.secrets);
    if (!ldapReady(settings) || settings.syncHours === 0) return;
    const last = settings.lastSync ? Date.parse(settings.lastSync.at) : 0;
    if (Date.now() - last < settings.syncHours * HOUR) return;
    running = true;
    try {
      await syncLdap(ctx, log);
    } catch {
      // Logged and stored in lastSync; next try after the interval.
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 5 * MINUTE);
  timer.unref();
  return () => clearInterval(timer);
}
