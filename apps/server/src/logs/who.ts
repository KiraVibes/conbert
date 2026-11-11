import { eq } from 'drizzle-orm';
import type { AppContext } from '../context';
import { users } from '../db/schema';

/** The user name for a log entry (the id if the account is gone). */
export function userName(ctx: AppContext, userId: string | null | undefined): string | null {
  if (!userId) return null;
  return (
    ctx.db.select({ username: users.username }).from(users).where(eq(users.id, userId)).get()
      ?.username ?? userId
  );
}

/** Long technical details, cut to their end (where the error usually is). */
export function tail(text: string | null | undefined, max = 1500): string | undefined {
  if (!text) return undefined;
  return text.length > max ? `…${text.slice(-max)}` : text;
}
