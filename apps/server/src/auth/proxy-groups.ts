import type { DbOrTx } from '../db';
import type { User } from '../db/schema';
import { applyAdminFromGroups, proxyGroupsByName, syncMemberships } from './permissions';
import { findUserById } from './users';

/** Re-check unchanged group headers at most this often (group settings may change). */
const RECHECK_MS = 60_000;

/** "a, b|c" → ['a', 'b', 'c'] (Authelia separates with commas, Authentik with |). */
export function parseProxyGroups(raw: string): string[] {
  return raw
    .split(/[,|]/)
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Puts reverse-proxy users into the Conbert groups whose "group name at the
 * reverse proxy" matches the groups header. Only runs when the header
 * changed (or after a minute), not on every request.
 */
export function createProxyGroupSync() {
  const seen = new Map<string, { raw: string; at: number }>();
  return {
    apply(db: DbOrTx, user: User, raw: string): User {
      const last = seen.get(user.id);
      if (last && last.raw === raw && Date.now() - last.at < RECHECK_MS) return user;
      seen.set(user.id, { raw, at: Date.now() });
      const byName = proxyGroupsByName(db);
      const ids = parseProxyGroups(raw).flatMap((name) => byName.get(name)?.id ?? []);
      syncMemberships(db, user.id, 'proxy', ids);
      applyAdminFromGroups(db, user.id);
      return findUserById(db, user.id) ?? user;
    },
  };
}
