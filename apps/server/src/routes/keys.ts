import type { FastifyInstance } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import { isAgeRecipient, isLockedIdentity } from '@conbert/core';
import {
  saveKeyRequestSchema,
  shareKeyRequestSchema,
  type MyKey,
  type SharedKey,
} from '@conbert/schemas';
import { currentUser } from '../auth/plugin';
import type { AppContext } from '../context';
import { userKeys, users, type UserKeyRecord } from '../db/schema';
import { HttpError } from '../lib/http-error';

const toMyKey = (row: UserKeyRecord): MyKey => ({
  publicKey: row.publicKey,
  lockedIdentity: row.lockedIdentity,
  shared: row.shared,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export function ownKey(ctx: AppContext, userId: string): UserKeyRecord | undefined {
  return ctx.db.select().from(userKeys).where(eq(userKeys.userId, userId)).get();
}

/** Public keys of other users who chose to share theirs (never anyone else's). */
export function sharedKeys(ctx: AppContext, exceptUserId: string): SharedKey[] {
  return ctx.db
    .select({
      userId: userKeys.userId,
      username: users.username,
      displayName: users.displayName,
      publicKey: userKeys.publicKey,
    })
    .from(userKeys)
    .innerJoin(users, eq(users.id, userKeys.userId))
    .where(and(eq(userKeys.shared, true), ne(userKeys.userId, exceptUserId)))
    .all();
}

/**
 * Key vault. The private key only ever arrives locked with the vault
 * password (age, scrypt) – the server checks that and can't open it.
 */
export function registerKeyRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/keys/me', async (request) => {
    const user = currentUser(request);
    const row = ownKey(ctx, user.id);
    return { key: row ? toMyKey(row) : null };
  });

  app.put('/api/keys/me', async (request) => {
    const user = currentUser(request);
    const body = saveKeyRequestSchema.parse(request.body);
    if (!isAgeRecipient(body.publicKey)) throw new HttpError(422, 'KEY_INVALID');
    // Never store a private key that isn't locked with a password.
    if (!isLockedIdentity(body.lockedIdentity)) throw new HttpError(422, 'KEY_NOT_LOCKED');
    const now = new Date();
    ctx.db
      .insert(userKeys)
      .values({ userId: user.id, ...body, updatedAt: now })
      .onConflictDoUpdate({
        target: userKeys.userId,
        set: { ...body, updatedAt: now },
      })
      .run();
    const row = ownKey(ctx, user.id);
    if (!row) throw new HttpError(500, 'INTERNAL');
    return { key: toMyKey(row) };
  });

  app.patch('/api/keys/me', async (request) => {
    const user = currentUser(request);
    const { shared } = shareKeyRequestSchema.parse(request.body);
    if (!ownKey(ctx, user.id)) throw new HttpError(404, 'NOT_FOUND');
    ctx.db
      .update(userKeys)
      .set({ shared, updatedAt: new Date() })
      .where(eq(userKeys.userId, user.id))
      .run();
    const row = ownKey(ctx, user.id);
    if (!row) throw new HttpError(500, 'INTERNAL');
    return { key: toMyKey(row) };
  });

  app.delete('/api/keys/me', async (request, reply) => {
    const user = currentUser(request);
    ctx.db.delete(userKeys).where(eq(userKeys.userId, user.id)).run();
    reply.status(204);
  });

  app.get('/api/keys/directory', async (request) => {
    const user = currentUser(request);
    return { keys: sharedKeys(ctx, user.id) };
  });
}
