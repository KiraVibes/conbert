import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  setupRequestSchema,
  type AuthStatusResponse,
  type UserResponse,
} from '@conbert/schemas';
import { currentUser } from '../auth/plugin';
import { ldapLogin } from '../auth/ldap/login';
import { getLdapSettings, ldapReady } from '../auth/ldap/settings';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/password';
import { FailureLimiter } from '../auth/rate-limit';
import { SESSION_COOKIE, createSession, deleteSession, deleteUserSessions } from '../auth/sessions';
import { getAuthState, markSetupDone, setupCodeMatches } from '../auth/setup';
import { countUsers, ensureProxyUser, findUserByName, insertUser, toUserDto } from '../auth/users';
import type { AppContext } from '../context';
import { users, type User } from '../db/schema';
import { HttpError } from '../lib/http-error';

function setSessionCookie(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  user: User,
): void {
  const { token, expiresAt } = createSession(
    ctx.db,
    user.id,
    ctx.config.sessionDays,
    request.headers['user-agent'],
  );
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.protocol === 'https',
    path: '/',
    expires: expiresAt,
  });
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const limiter = new FailureLimiter();
  const setupLimiter = new FailureLimiter(10, 15 * 60 * 1000);

  app.get('/api/auth/status', async (request): Promise<AuthStatusResponse> => {
    const state = getAuthState(ctx.db);
    return {
      setupRequired: !state.setupDone,
      authMode: state.authMode,
      proxyAvailable: ctx.config.proxyAuth !== undefined,
      proxyUser: state.setupDone ? null : request.proxyUserName,
      ldap: ldapReady(getLdapSettings(ctx.db, ctx.secrets)),
      user: request.user ? toUserDto(ctx.db, request.user) : null,
    };
  });

  app.post('/api/auth/setup', async (request, reply): Promise<UserResponse> => {
    const body = setupRequestSchema.parse(request.body);
    if (getAuthState(ctx.db).setupDone) throw new HttpError(409, 'SETUP_DONE');

    const limitKey = request.ip;
    if (setupLimiter.retryAfter(limitKey) > 0) throw new HttpError(429, 'TOO_MANY_ATTEMPTS');
    if (!setupCodeMatches(ctx.setupCode, body.setupCode)) {
      setupLimiter.fail(limitKey);
      throw new HttpError(403, 'INVALID_SETUP_CODE');
    }

    if (body.mode === 'proxy') {
      if (!ctx.config.proxyAuth || !request.proxyUserName) {
        throw new HttpError(400, 'BAD_REQUEST', 'no user header from a trusted proxy');
      }
      const proxyName = request.proxyUserName;
      const admin = ctx.db.transaction((tx) => {
        if (getAuthState(tx).setupDone) throw new HttpError(409, 'SETUP_DONE');
        const user = ensureProxyUser(tx, proxyName, 'admin');
        if (!user) throw new HttpError(400, 'BAD_REQUEST', 'invalid user name from proxy');
        tx.update(users).set({ role: 'admin' }).where(eq(users.id, user.id)).run();
        markSetupDone(tx, 'proxy');
        return { ...user, role: 'admin' as const };
      });
      request.log.info({ user: admin.username }, 'setup completed (reverse-proxy login)');
      return { user: toUserDto(ctx.db, admin) };
    }

    const passwordHash = await hashPassword(body.password);
    const admin = ctx.db.transaction((tx) => {
      const db = tx;
      if (getAuthState(db).setupDone || countUsers(db) > 0) throw new HttpError(409, 'SETUP_DONE');
      const user = insertUser(db, {
        username: body.username,
        displayName: body.displayName,
        passwordHash,
        role: 'admin',
      });
      markSetupDone(db, 'local');
      return user;
    });
    request.log.info({ user: admin.username }, 'setup completed');
    setSessionCookie(ctx, request, reply, admin);
    return { user: toUserDto(ctx.db, admin) };
  });

  app.post('/api/auth/login', async (request, reply): Promise<UserResponse> => {
    const body = loginRequestSchema.parse(request.body);
    const state = getAuthState(ctx.db);
    if (!state.setupDone) throw new HttpError(403, 'SETUP_REQUIRED');

    const limitKey = `${request.ip}|${body.username}`;
    const wait = limiter.retryAfter(limitKey);
    if (wait > 0) {
      reply.header('Retry-After', String(wait));
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS');
    }

    const local = findUserByName(ctx.db, body.username);
    let user: User | null = null;
    if (local?.passwordHash && local.authSource === 'local') {
      if (await verifyPassword(body.password, local.passwordHash)) user = local;
    } else {
      // Directory account (or unknown name): ask LDAP if it is switched on.
      user = await ldapLogin(ctx, body.username, body.password, request.log);
      // Always run the hash so unknown names take as long as wrong passwords.
      if (!user) await verifyPassword(body.password, await getDummyHash());
    }
    if (!user || user.disabled) {
      limiter.fail(limitKey);
      throw new HttpError(401, 'INVALID_LOGIN');
    }
    limiter.reset(limitKey);
    setSessionCookie(ctx, request, reply, user);
    return { user: toUserDto(ctx.db, user) };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) deleteSession(ctx.db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/password', async (request) => {
    const user = currentUser(request);
    const body = changePasswordRequestSchema.parse(request.body);
    if (user.authSource !== 'local') throw new HttpError(400, 'LDAP_MANAGED');
    if (!user.passwordHash || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
      throw new HttpError(400, 'WRONG_PASSWORD');
    }
    const passwordHash = await hashPassword(body.newPassword);
    ctx.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .run();
    // Sign out all other devices, keep this one.
    deleteUserSessions(ctx.db, user.id, request.cookies[SESSION_COOKIE]);
    return { ok: true };
  });
}
