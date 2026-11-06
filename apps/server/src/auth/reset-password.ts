import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { users } from '../db/schema';
import { hashPassword } from './password';
import { deleteUserSessions } from './sessions';
import { findUserByName } from './users';

/** A random password that is easy to type: 4 groups of 5 letters and digits. */
export function randomPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(20);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return chars.match(/.{5}/g)?.join('-') ?? chars;
}

/**
 * Sets a new random password for a user and signs them out everywhere – the
 * way back in when the only admin forgot the password. Run on the server:
 * `node server/dist/index.mjs reset-password <username>`.
 * Returns null if there is no such user.
 */
export async function resetPassword(db: Db, username: string): Promise<string | null> {
  const user = findUserByName(db, username);
  if (!user) return null;
  const password = randomPassword();
  db.update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .run();
  deleteUserSessions(db, user.id);
  return password;
}
