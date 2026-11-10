import type { FastifyInstance } from 'fastify';
import { eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  createUserRequestSchema,
  updateUserRequestSchema,
  type UserResponse,
  type UsersResponse,
} from '@conbert/schemas';
import { currentUser, requireAdmin } from '../auth/plugin';
import { hashPassword } from '../auth/password';
import { deleteUserSessions } from '../auth/sessions';
import {
  countAdmins,
  findUserById,
  findUserByName,
  insertUser,
  listUsers,
  toUserDto,
} from '../auth/users';
import { syncMemberships } from '../auth/permissions';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db';
import { booruSettings, groups, users } from '../db/schema';
import { HttpError } from '../lib/http-error';

const idParams = z.object({ id: z.string().min(1).max(64) });

/** Replaces the hand-picked groups of a user; LDAP/proxy memberships stay. */
function setManualGroups(db: DbOrTx, userId: string, groupIds: string[]): void {
  const wanted = new Set(groupIds);
  const known = new Set(
    db
      .select({ id: groups.id })
      .from(groups)
      .all()
      .map((g) => g.id),
  );
  for (const gid of wanted)
    if (!known.has(gid)) throw new HttpError(400, 'BAD_REQUEST', `group ${gid}`);
  syncMemberships(db, userId, 'manual', [...wanted]);
}

/** User management – administrators only. */
export function registerUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { preHandler: requireAdmin };

  app.get('/api/users', admin, async (): Promise<UsersResponse> => {
    const locked = new Set(
      ctx.db
        .select({ userId: booruSettings.userId })
        .from(booruSettings)
        .where(isNotNull(booruSettings.lockHash))
        .all()
        .map((r) => r.userId),
    );
    return {
      users: listUsers(ctx.db).map((u) => ({
        ...toUserDto(ctx.db, u, { admin: true }),
        booruPin: locked.has(u.id),
      })),
    };
  });

  app.post('/api/users', admin, async (request, reply): Promise<UserResponse> => {
    const body = createUserRequestSchema.parse(request.body);
    if (findUserByName(ctx.db, body.username)) throw new HttpError(409, 'USERNAME_TAKEN');
    const user = insertUser(ctx.db, {
      username: body.username,
      displayName: body.displayName,
      passwordHash: await hashPassword(body.password),
      role: body.role,
    });
    reply.status(201);
    return { user: toUserDto(ctx.db, user, { admin: true }) };
  });

  app.patch('/api/users/:id', admin, async (request): Promise<UserResponse> => {
    const { id } = idParams.parse(request.params);
    const body = updateUserRequestSchema.parse(request.body);
    const user = findUserById(ctx.db, id);
    if (!user) throw new HttpError(404, 'NOT_FOUND');
    if (body.role === 'user' && user.role === 'admin' && countAdmins(ctx.db) <= 1) {
      throw new HttpError(409, 'LAST_ADMIN');
    }
    // LDAP and proxy accounts sign in elsewhere; a password here would be a back door.
    if (body.password && user.authSource !== 'local') throw new HttpError(400, 'LDAP_MANAGED');
    const passwordHash = body.password ? await hashPassword(body.password) : undefined;
    ctx.db.transaction((tx) => {
      tx.update(users)
        .set({
          ...(body.role ? { role: body.role } : {}),
          ...(body.displayName !== undefined ? { displayName: body.displayName || null } : {}),
          ...(passwordHash ? { passwordHash } : {}),
          ...(body.permissionOverrides ? { permissionOverrides: body.permissionOverrides } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .run();
      if (body.groupIds) setManualGroups(tx, id, body.groupIds);
    });
    // A password reset signs the user out everywhere.
    if (passwordHash) deleteUserSessions(ctx.db, id);
    const updated = findUserById(ctx.db, id);
    if (!updated) throw new HttpError(404, 'NOT_FOUND');
    return { user: toUserDto(ctx.db, updated, { admin: true }) };
  });

  // A forgotten booru PIN: the admin lifts the lock (the ratings stay as they are).
  app.delete('/api/users/:id/booru-pin', admin, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const user = findUserById(ctx.db, id);
    if (!user) throw new HttpError(404, 'NOT_FOUND');
    ctx.db
      .update(booruSettings)
      .set({ lockHash: null, updatedAt: new Date() })
      .where(eq(booruSettings.userId, id))
      .run();
    request.log.info({ userId: id }, 'booru PIN reset by an administrator');
    reply.status(204);
  });

  app.delete('/api/users/:id', admin, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const user = findUserById(ctx.db, id);
    if (!user) throw new HttpError(404, 'NOT_FOUND');
    if (user.role === 'admin' && countAdmins(ctx.db) <= 1) throw new HttpError(409, 'LAST_ADMIN');
    if (user.id === currentUser(request).id && countAdmins(ctx.db) <= 1) {
      throw new HttpError(409, 'LAST_ADMIN');
    }
    // Sessions, settings, files and jobs go with the user (ON DELETE CASCADE).
    ctx.db.delete(users).where(eq(users.id, id)).run();
    reply.status(204);
  });
}
