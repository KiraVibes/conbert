import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db';
import { sessions, users, type User } from '../db/schema';

export const SESSION_COOKIE = 'conbert_session';
const DAY = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a session and returns the secret token for the cookie. */
export function createSession(
  db: Db,
  userId: string,
  days: number,
  userAgent?: string,
): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * DAY);
  db.insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      expiresAt,
      lastSeenAt: new Date(),
      userAgent: userAgent?.slice(0, 200) ?? null,
    })
    .run();
  return { token, expiresAt };
}

/**
 * Returns the user of a valid session. Sessions slide: each use extends them,
 * but the database is only written once per hour per session.
 */
export function validateSession(db: Db, token: string, days: number): User | undefined {
  const id = hashToken(token);
  const row = db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .get();
  if (!row) return undefined;
  const lastSeen = row.session.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - lastSeen > 60 * 60 * 1000) {
    db.update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + days * DAY) })
      .where(eq(sessions.id, id))
      .run();
  }
  return row.user;
}

export function deleteSession(db: Db, token: string): void {
  db.delete(sessions)
    .where(eq(sessions.id, hashToken(token)))
    .run();
}

/** Signs a user out everywhere (after a password change or deletion). */
export function deleteUserSessions(db: DbOrTx, userId: string, exceptToken?: string): void {
  const keep = exceptToken ? hashToken(exceptToken) : undefined;
  const rows = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .all();
  for (const row of rows) {
    if (row.id !== keep) db.delete(sessions).where(eq(sessions.id, row.id)).run();
  }
}

export function deleteExpiredSessions(db: Db): number {
  return db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run().changes;
}
