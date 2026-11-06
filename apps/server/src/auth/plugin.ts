import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { AppContext } from '../context';
import type { User } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { SESSION_COOKIE, validateSession } from './sessions';
import { getAuthState } from './setup';
import { validateApiToken } from './tokens';
import { createProxyMatcher } from './trusted-proxies';
import { ensureProxyUser } from './users';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user, or null. Set for every request. */
    user: User | null;
    /** User name a trusted reverse proxy sent (whether or not proxy mode is active). */
    proxyUserName: string | null;
    /** How the user signed in: browser session, reverse proxy or API token. */
    authMethod: 'session' | 'proxy' | 'token' | null;
  }
}

/** API routes that work without being signed in. */
const PUBLIC_API = new Set([
  '/api/health',
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/auth/logout',
  // Describes the API, contains nothing secret.
  '/api/openapi.json',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * What an API token may not do: manage tokens, users, passwords or the key
 * vault. A leaked token can convert files but not take over the account.
 */
const NOT_WITH_TOKEN = ['/api/tokens', '/api/users', '/api/auth/', '/api/keys'];

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match?.[1] ?? null;
}

function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

/** true if the request has no Origin header or one that matches this server. */
export function isSameOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    // Parse our own host the same way so default ports compare equal.
    const own = new URL(`${request.protocol}://${request.host}`).host;
    return new URL(origin).host === own;
  } catch {
    return false;
  }
}

/**
 * Blocks state-changing requests that a browser sent from another website
 * (CSRF). Requests without an Origin header (CLI tools, scripts) pass.
 */
function checkOrigin(request: FastifyRequest): void {
  if (SAFE_METHODS.has(request.method)) return;
  if (!isSameOrigin(request)) {
    throw new HttpError(403, 'CROSS_ORIGIN', `${request.headers.origin ?? ''} ≠ ${request.host}`);
  }
}

export async function registerAuth(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(fastifyCookie);
  app.decorateRequest('user', null);
  app.decorateRequest('proxyUserName', null);
  app.decorateRequest('authMethod', null);

  const proxy = ctx.config.proxyAuth;
  const isTrustedProxy = proxy ? createProxyMatcher(proxy.trustedProxies) : () => false;

  app.addHook('onRequest', async (request) => {
    const path = pathOf(request.url);
    if (!path.startsWith('/api/')) return;
    checkOrigin(request);

    // The header only counts if the connection really comes from the proxy.
    if (proxy && isTrustedProxy(request.socket.remoteAddress)) {
      const value = request.headers[proxy.header];
      const name = Array.isArray(value) ? value[0] : value;
      request.proxyUserName = name?.trim() || null;
    }

    const state = getAuthState(ctx.db);
    const bearer = bearerToken(request);
    if (bearer && state.setupDone) {
      // Scripts and the CLI, in both login modes. A wrong token is no login.
      request.user = validateApiToken(ctx.db, bearer) ?? null;
      if (!request.user) throw new HttpError(401, 'INVALID_TOKEN');
      request.authMethod = 'token';
      if (path !== '/api/auth/status' && NOT_WITH_TOKEN.some((p) => path.startsWith(p))) {
        throw new HttpError(403, 'TOKEN_NOT_ALLOWED');
      }
      return;
    }
    if (state.setupDone && state.authMode === 'proxy') {
      if (request.proxyUserName) {
        request.user = ensureProxyUser(ctx.db, request.proxyUserName) ?? null;
        if (request.user) request.authMethod = 'proxy';
      }
    } else {
      const token = request.cookies[SESSION_COOKIE];
      if (token) request.user = validateSession(ctx.db, token, ctx.config.sessionDays) ?? null;
      if (request.user) request.authMethod = 'session';
    }

    // Unknown routes answer 404 (handled by the not-found handler).
    if (PUBLIC_API.has(path) || request.user || request.is404) return;
    throw state.setupDone
      ? new HttpError(401, 'UNAUTHORIZED')
      : new HttpError(403, 'SETUP_REQUIRED');
  });
}

/** preHandler for administrator-only routes. */
export async function requireAdmin(request: FastifyRequest): Promise<void> {
  if (request.user?.role !== 'admin') throw new HttpError(403, 'FORBIDDEN');
}

/** The signed-in user; only call in routes protected by the auth hook. */
export function currentUser(request: FastifyRequest): User {
  if (!request.user) throw new HttpError(401, 'UNAUTHORIZED');
  return request.user;
}
