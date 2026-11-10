import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  createGroupRequestSchema,
  groupMembersRequestSchema,
  updateGroupRequestSchema,
  type GroupDto,
  type GroupResponse,
  type GroupsResponse,
} from '@conbert/schemas';
import { everyoneGroup } from '../auth/permissions';
import { requireAdmin } from '../auth/plugin';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db';
import { groupMembers, groups, users, type Group } from '../db/schema';
import { HttpError } from '../lib/http-error';

const idParams = z.object({ id: z.string().min(1).max(64) });

export function toGroupDto(db: DbOrTx, group: Group): GroupDto {
  const members =
    group.builtin === 'everyone'
      ? []
      : db
          .select({ userId: users.id, username: users.username, source: groupMembers.source })
          .from(groupMembers)
          .innerJoin(users, eq(groupMembers.userId, users.id))
          .where(eq(groupMembers.groupId, group.id))
          .orderBy(users.username)
          .all();
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    builtin: group.builtin,
    permissions: group.permissions,
    grantsAdmin: group.grantsAdmin,
    ldapDn: group.ldapDn,
    proxyName: group.proxyName,
    members,
  };
}

export function listGroups(db: DbOrTx): Group[] {
  everyoneGroup(db);
  return db
    .select()
    .from(groups)
    .all()
    .sort((a, b) =>
      a.builtin === 'everyone' ? -1 : b.builtin === 'everyone' ? 1 : a.name.localeCompare(b.name),
    );
}

function findGroup(db: DbOrTx, id: string): Group {
  const group = db.select().from(groups).where(eq(groups.id, id)).get();
  if (!group) throw new HttpError(404, 'NOT_FOUND');
  return group;
}

function nameTaken(db: DbOrTx, name: string, exceptId?: string): boolean {
  const lower = name.toLowerCase();
  return db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .all()
    .some((g) => g.id !== exceptId && g.name.toLowerCase() === lower);
}

/** Creates a group (also used by the LDAP import). Picks a free name if needed. */
export function insertGroup(
  db: DbOrTx,
  data: {
    name: string;
    description?: string | null | undefined;
    permissions?: Partial<Record<string, boolean>>;
    grantsAdmin?: boolean;
    ldapDn?: string | null;
    proxyName?: string | null | undefined;
  },
): Group {
  const id = randomUUID();
  db.insert(groups)
    .values({
      id,
      name: data.name,
      description: data.description || null,
      permissions: data.permissions ?? {},
      grantsAdmin: data.grantsAdmin ?? false,
      ldapDn: data.ldapDn ?? null,
      proxyName: data.proxyName || null,
    })
    .run();
  return findGroup(db, id);
}

/** A name like "Team (2)" if "Team" is already taken. */
export function freeGroupName(db: DbOrTx, wanted: string): string {
  if (!nameTaken(db, wanted)) return wanted;
  for (let i = 2; ; i++) {
    const candidate = `${wanted} (${i})`;
    if (!nameTaken(db, candidate)) return candidate;
  }
}

/** Groups and their functions – administrators only. */
export function registerGroupRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { preHandler: requireAdmin };

  app.get('/api/groups', admin, async (): Promise<GroupsResponse> => ({
    groups: listGroups(ctx.db).map((g) => toGroupDto(ctx.db, g)),
  }));

  app.post('/api/groups', admin, async (request, reply): Promise<GroupResponse> => {
    const body = createGroupRequestSchema.parse(request.body);
    if (nameTaken(ctx.db, body.name)) throw new HttpError(409, 'GROUP_NAME_TAKEN');
    const group = insertGroup(ctx.db, body);
    reply.status(201);
    return { group: toGroupDto(ctx.db, group) };
  });

  app.patch('/api/groups/:id', admin, async (request): Promise<GroupResponse> => {
    const { id } = idParams.parse(request.params);
    const body = updateGroupRequestSchema.parse(request.body);
    const group = findGroup(ctx.db, id);
    if (group.builtin && (body.name !== undefined || body.grantsAdmin || body.proxyName)) {
      // "Everyone" only has functions; renaming or admin rights make no sense there.
      throw new HttpError(400, 'GROUP_BUILTIN');
    }
    if (body.name !== undefined && nameTaken(ctx.db, body.name, id)) {
      throw new HttpError(409, 'GROUP_NAME_TAKEN');
    }
    ctx.db
      .update(groups)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.permissions ? { permissions: body.permissions } : {}),
        ...(body.grantsAdmin !== undefined ? { grantsAdmin: body.grantsAdmin } : {}),
        ...(body.proxyName !== undefined ? { proxyName: body.proxyName || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(groups.id, id))
      .run();
    return { group: toGroupDto(ctx.db, findGroup(ctx.db, id)) };
  });

  // Hand-picked members; members from LDAP or the proxy stay as they are.
  app.put('/api/groups/:id/members', admin, async (request): Promise<GroupResponse> => {
    const { id } = idParams.parse(request.params);
    const { userIds } = groupMembersRequestSchema.parse(request.body);
    const group = findGroup(ctx.db, id);
    if (group.builtin) throw new HttpError(400, 'GROUP_BUILTIN');
    const wanted = new Set(userIds);
    const known =
      wanted.size === 0
        ? []
        : ctx.db
            .select({ id: users.id })
            .from(users)
            .where(inArray(users.id, [...wanted]))
            .all();
    if (known.length !== wanted.size) throw new HttpError(400, 'BAD_REQUEST', 'unknown user');
    ctx.db.transaction((tx) => {
      const current = tx.select().from(groupMembers).where(eq(groupMembers.groupId, id)).all();
      for (const row of current) {
        if (row.source === 'manual' && !wanted.has(row.userId)) {
          tx.delete(groupMembers)
            .where(and(eq(groupMembers.groupId, id), eq(groupMembers.userId, row.userId)))
            .run();
        }
      }
      const have = new Set(current.map((r) => r.userId));
      for (const userId of wanted) {
        if (!have.has(userId)) {
          tx.insert(groupMembers).values({ groupId: id, userId, source: 'manual' }).run();
        }
      }
    });
    return { group: toGroupDto(ctx.db, findGroup(ctx.db, id)) };
  });

  app.delete('/api/groups/:id', admin, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const group = findGroup(ctx.db, id);
    if (group.builtin) throw new HttpError(400, 'GROUP_BUILTIN');
    // Memberships go with the group (ON DELETE CASCADE).
    ctx.db.delete(groups).where(eq(groups.id, id)).run();
    reply.status(204);
  });
}
