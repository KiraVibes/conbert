import { randomUUID } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import type { AuthSource, PermissionOverrides, Role, UserDto } from '@conbert/schemas';
import type { DbOrTx } from '../db';
import { users, type User } from '../db/schema';
import { effectivePermissions, userGroups } from './permissions';

/** The user as the API shows it. `admin: true` adds groups and own settings. */
export function toUserDto(db: DbOrTx, user: User, opts: { admin?: boolean } = {}): UserDto {
  const dto: UserDto = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    hasPassword: user.passwordHash !== null,
    createdAt: user.createdAt.toISOString(),
    authSource: user.authSource,
    permissions: effectivePermissions(db, user),
  };
  if (opts.admin) {
    dto.groups = userGroups(db, user.id)
      .filter((g) => g.builtin === null)
      .map((g) => ({ id: g.id, name: g.name }));
    dto.permissionOverrides = user.permissionOverrides as PermissionOverrides;
    dto.disabled = user.disabled;
  }
  return dto;
}

export function findUserByName(db: DbOrTx, username: string): User | undefined {
  return db.select().from(users).where(eq(users.username, username.toLowerCase())).get();
}

export function findUserById(db: DbOrTx, id: string): User | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function listUsers(db: DbOrTx): User[] {
  return db.select().from(users).orderBy(users.username).all();
}

export function countAdmins(db: DbOrTx): number {
  return db.select({ n: count() }).from(users).where(eq(users.role, 'admin')).get()?.n ?? 0;
}

export function countUsers(db: DbOrTx): number {
  return db.select({ n: count() }).from(users).get()?.n ?? 0;
}

export interface NewUser {
  username: string;
  passwordHash: string | null;
  role: Role;
  displayName?: string | undefined;
  authSource?: AuthSource;
  ldapDn?: string | null;
}

export function insertUser(db: DbOrTx, data: NewUser): User {
  const id = randomUUID();
  db.insert(users)
    .values({
      id,
      username: data.username.toLowerCase(),
      passwordHash: data.passwordHash,
      role: data.role,
      displayName: data.displayName?.trim() || null,
      authSource: data.authSource ?? 'local',
      ldapDn: data.ldapDn ?? null,
    })
    .run();
  const user = findUserById(db, id);
  if (!user) throw new Error('user insert failed');
  return user;
}

/** Names a reverse proxy may send: e-mail addresses are common there. */
const PROXY_NAME = /^[a-z0-9._@+-]{1,64}$/;

/**
 * Finds or creates the user a trusted reverse proxy reported. Returns
 * undefined for names that don't look like a user name at all.
 */
export function ensureProxyUser(
  db: DbOrTx,
  rawName: string,
  role: Role = 'user',
): User | undefined {
  const name = rawName.trim().toLowerCase();
  if (!PROXY_NAME.test(name)) return undefined;
  return (
    findUserByName(db, name) ??
    insertUser(db, { username: name, passwordHash: null, role, authSource: 'proxy' })
  );
}
