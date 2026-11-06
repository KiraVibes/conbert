import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { ApiToken } from '@conbert/schemas';
import type { Db } from '../db';
import { apiTokens, users, type ApiTokenRecord, type User } from '../db/schema';

/** Every token starts like this, so leaked ones are easy to find and tell apart. */
export const TOKEN_PREFIX = 'cbt_';
const DAY = 24 * 60 * 60 * 1000;
/** "Last used" is written at most once a minute per token. */
const TOUCH_MS = 60_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export const toApiToken = (row: ApiTokenRecord): ApiToken => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  expiresAt: row.expiresAt?.toISOString() ?? null,
});

export function createApiToken(
  db: Db,
  userId: string,
  name: string,
  expiresInDays: number | null,
): { token: ApiToken; secret: string } {
  const secret = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const row: ApiTokenRecord = {
    id: randomUUID(),
    userId,
    name,
    tokenHash: hash(secret),
    prefix: `${secret.slice(0, TOKEN_PREFIX.length + 6)}…`,
    createdAt: new Date(),
    lastUsedAt: null,
    expiresAt: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * DAY),
  };
  db.insert(apiTokens).values(row).run();
  return { token: toApiToken(row), secret };
}

export function listApiTokens(db: Db, userId: string): ApiToken[] {
  return db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt))
    .all()
    .map(toApiToken);
}

export function revokeApiToken(db: Db, userId: string, id: string): boolean {
  const result = db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
    .run();
  return result.changes > 0;
}

/** The user a valid, unexpired token belongs to. */
export function validateApiToken(db: Db, secret: string): User | undefined {
  if (!secret.startsWith(TOKEN_PREFIX)) return undefined;
  const row = db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hash(secret)))
    .get();
  if (!row) return undefined;
  const now = Date.now();
  if (row.expiresAt && row.expiresAt.getTime() <= now) return undefined;
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > TOUCH_MS) {
    db.update(apiTokens)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(apiTokens.id, row.id))
      .run();
  }
  return db.select().from(users).where(eq(users.id, row.userId)).get();
}
