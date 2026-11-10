import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { FEATURES, type Feature } from '@conbert/schemas';
import type { DbOrTx } from '../db';
import { groupMembers, groups, users, type Group, type User } from '../db/schema';

export const EVERYONE_GROUP_ID = 'everyone';

/**
 * Which API paths belong to which function. Checked for every request after
 * sign-in (browser, proxy and API token). Admins may always do everything.
 * File uploads and downloads (/api/upload, /api/files) stay open: several
 * functions need them and the storage quota already limits them. AI is
 * checked per job (the AI engines run through /api/jobs).
 */
const FEATURE_ROUTES: [prefix: string, feature: Feature][] = [
  ['/api/jobs', 'serverConvert'],
  ['/api/convert', 'serverConvert'],
  ['/api/downloader', 'downloader'],
  ['/api/booru', 'booru'],
  ['/api/subscriptions', 'booru'],
  ['/api/workflows', 'workflows'],
  ['/api/workflow-runs', 'workflows'],
  ['/api/targets', 'storage'],
  ['/api/media', 'media'],
  ['/api/swipe', 'media'],
  ['/api/tokens', 'apiTokens'],
];

/** Engines that count as "AI" (checked when a job starts, see routes/jobs.ts). */
export const AI_ENGINES = new Set(['whisper', 'image-ai']);

export function featureForPath(path: string): Feature | null {
  for (const [prefix, feature] of FEATURE_ROUTES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return feature;
  }
  return null;
}

/** The built-in group every user belongs to. Created by the migration; recreated if missing. */
export function everyoneGroup(db: DbOrTx): Group {
  const existing = db.select().from(groups).where(eq(groups.builtin, 'everyone')).get();
  if (existing) return existing;
  db.insert(groups)
    .values({ id: EVERYONE_GROUP_ID, name: 'everyone', builtin: 'everyone' })
    .onConflictDoNothing()
    .run();
  const created = db.select().from(groups).where(eq(groups.builtin, 'everyone')).get();
  if (!created) throw new Error('everyone group missing');
  return created;
}

/** Does this group allow the function? The "everyone" group allows what it doesn't forbid. */
export function groupAllows(
  group: Pick<Group, 'builtin' | 'permissions'>,
  feature: Feature,
): boolean {
  const value = group.permissions[feature];
  return group.builtin === 'everyone' ? value !== false : value === true;
}

/** The groups a user belongs to, including the built-in "everyone" group. */
export function userGroups(db: DbOrTx, userId: string): Group[] {
  const rows = db
    .select({ group: groups })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, userId))
    .all()
    .map((r) => r.group)
    .filter((g) => g.builtin !== 'everyone');
  return [everyoneGroup(db), ...rows];
}

/**
 * The functions a user may use: admins all; otherwise the user's own
 * allow/deny wins, else allowed if at least one group allows it.
 */
export function effectivePermissions(
  db: DbOrTx,
  user: Pick<User, 'id' | 'role' | 'permissionOverrides'>,
): Feature[] {
  if (user.role === 'admin') return [...FEATURES];
  const memberOf = userGroups(db, user.id);
  return FEATURES.filter((feature) => {
    const own = user.permissionOverrides[feature];
    if (own === 'deny') return false;
    if (own === 'allow') return true;
    return memberOf.some((g) => groupAllows(g, feature));
  });
}

export function can(
  db: DbOrTx,
  user: Pick<User, 'id' | 'role' | 'permissionOverrides'>,
  feature: Feature,
): boolean {
  return effectivePermissions(db, user).includes(feature);
}

/**
 * For background work (subscriptions, feeds, workflow runs): may the owner
 * still use this function? false for deleted or disabled users too.
 */
export function ownerMay(db: DbOrTx, userId: string, feature: Feature): boolean {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  return !!user && !user.disabled && can(db, user, feature);
}

/**
 * Brings a user's memberships of one kind in line with the given group ids.
 * Memberships of other kinds stay (an LDAP sync never removes what the admin
 * picked by hand, and the other way round).
 */
export function syncMemberships(
  db: DbOrTx,
  userId: string,
  source: 'manual' | 'ldap' | 'proxy',
  groupIds: string[],
): void {
  const wanted = new Set(groupIds);
  const current = db.select().from(groupMembers).where(eq(groupMembers.userId, userId)).all();
  for (const row of current) {
    if (row.source === source && !wanted.has(row.groupId)) {
      db.delete(groupMembers)
        .where(and(eq(groupMembers.groupId, row.groupId), eq(groupMembers.userId, userId)))
        .run();
    }
  }
  const have = new Set(current.map((r) => r.groupId));
  for (const groupId of wanted) {
    if (have.has(groupId) || groupId === EVERYONE_GROUP_ID) continue;
    db.insert(groupMembers).values({ groupId, userId, source }).onConflictDoNothing().run();
  }
}

/** Groups that carry an LDAP DN, keyed by DN (as stored: normalized). */
export function ldapGroupsByDn(db: DbOrTx): Map<string, Group> {
  const rows = db.select().from(groups).where(isNotNull(groups.ldapDn)).all();
  return new Map(rows.map((g) => [g.ldapDn ?? '', g]));
}

/** Groups that carry a proxy group name, keyed by lowercase name. */
export function proxyGroupsByName(db: DbOrTx): Map<string, Group> {
  const rows = db.select().from(groups).where(isNotNull(groups.proxyName)).all();
  return new Map(rows.map((g) => [(g.proxyName ?? '').toLowerCase(), g]));
}

export function groupsByIds(db: DbOrTx, ids: string[]): Group[] {
  if (ids.length === 0) return [];
  return db.select().from(groups).where(inArray(groups.id, ids)).all();
}

/**
 * LDAP and proxy accounts: administrator exactly when they are in a group
 * with "members are administrators". Only applies once such a group exists,
 * and never removes the last administrator.
 */
export function applyAdminFromGroups(db: DbOrTx, userId: string): void {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || user.authSource === 'local') return;
  const adminGroups = db.select().from(groups).where(eq(groups.grantsAdmin, true)).all();
  if (adminGroups.length === 0) return;
  const memberOf = new Set(userGroups(db, userId).map((g) => g.id));
  const shouldBeAdmin = adminGroups.some((g) => memberOf.has(g.id));
  const role = shouldBeAdmin ? 'admin' : 'user';
  if (role === user.role) return;
  if (role === 'user') {
    const admins = db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).all();
    if (admins.length <= 1) return;
  }
  db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId)).run();
}
