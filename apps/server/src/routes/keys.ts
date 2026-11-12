import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { isAgeRecipient, isLockedIdentity } from '@conbert/core';
import {
  MAX_CONTACTS,
  createContactRequestSchema,
  saveKeyRequestSchema,
  shareKeyRequestSchema,
  updateContactRequestSchema,
  type Contact,
  type MyKey,
  type SharedKey,
} from '@conbert/schemas';
import { currentUser } from '../auth/plugin';
import type { AppContext } from '../context';
import {
  ageContacts,
  userKeys,
  users,
  type AgeContactRecord,
  type UserKeyRecord,
} from '../db/schema';
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

const toContact = (row: AgeContactRecord): Contact => ({
  id: row.id,
  name: row.name,
  publicKey: row.publicKey,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** The user's own contact book, sorted by name. */
export function contactsOf(ctx: AppContext, userId: string): AgeContactRecord[] {
  return ctx.db
    .select()
    .from(ageContacts)
    .where(eq(ageContacts.userId, userId))
    .orderBy(asc(ageContacts.name))
    .all();
}

function ownContact(ctx: AppContext, userId: string, id: string): AgeContactRecord | undefined {
  return ctx.db
    .select()
    .from(ageContacts)
    .where(and(eq(ageContacts.id, id), eq(ageContacts.userId, userId)))
    .get();
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

  // Contact book – every contact belongs to exactly one user.
  app.get('/api/keys/contacts', async (request) => {
    const user = currentUser(request);
    return { contacts: contactsOf(ctx, user.id).map(toContact) };
  });

  app.post('/api/keys/contacts', async (request, reply) => {
    const user = currentUser(request);
    const body = createContactRequestSchema.parse(request.body);
    if (!isAgeRecipient(body.publicKey)) throw new HttpError(422, 'CONTACT_KEY_INVALID');
    const existing = ctx.db
      .select()
      .from(ageContacts)
      .where(and(eq(ageContacts.userId, user.id), eq(ageContacts.publicKey, body.publicKey)))
      .get();
    if (existing) throw new HttpError(409, 'CONTACT_EXISTS', existing.name);
    const total =
      ctx.db.select({ n: count() }).from(ageContacts).where(eq(ageContacts.userId, user.id)).get()
        ?.n ?? 0;
    if (total >= MAX_CONTACTS) throw new HttpError(422, 'CONTACT_LIMIT');
    const now = new Date();
    const row: AgeContactRecord = {
      id: randomUUID(),
      userId: user.id,
      name: body.name,
      publicKey: body.publicKey,
      note: body.note ? body.note : null,
      createdAt: now,
      updatedAt: now,
    };
    ctx.db.insert(ageContacts).values(row).run();
    reply.status(201);
    return { contact: toContact(row) };
  });

  app.patch('/api/keys/contacts/:id', async (request) => {
    const user = currentUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateContactRequestSchema.parse(request.body);
    if (!ownContact(ctx, user.id, id)) throw new HttpError(404, 'NOT_FOUND');
    ctx.db
      .update(ageContacts)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.note !== undefined && { note: body.note ? body.note : null }),
        updatedAt: new Date(),
      })
      .where(and(eq(ageContacts.id, id), eq(ageContacts.userId, user.id)))
      .run();
    const row = ownContact(ctx, user.id, id);
    if (!row) throw new HttpError(500, 'INTERNAL');
    return { contact: toContact(row) };
  });

  app.delete('/api/keys/contacts/:id', async (request, reply) => {
    const user = currentUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (!ownContact(ctx, user.id, id)) throw new HttpError(404, 'NOT_FOUND');
    ctx.db
      .delete(ageContacts)
      .where(and(eq(ageContacts.id, id), eq(ageContacts.userId, user.id)))
      .run();
    reply.status(204);
  });
}
