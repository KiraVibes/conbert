import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { DeviantartStatus } from '@conbert/schemas';
import type { AppContext } from '../context';
import { downloaderCookies } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { runProcess } from '../lib/run-process';
import { toolEnv, toolHome, toolPath } from './tools';

/**
 * DeviantArt with your own API app. gallery-dl talks to DeviantArt's OAuth
 * API; its built-in app is shared by every gallery-dl user and often hits
 * DeviantArt's limit. With an app of your own (client ID + secret) the limit
 * is yours alone; logging in on DeviantArt's own page (Conbert never sees the
 * password) adds a refresh token, so mature and private works load too.
 *
 * Stored in the cookies table (row "deviantart"), encrypted under its own
 * context, never logged and never sent back (only the client ID, which is
 * no secret).
 */

const PLATFORM = 'deviantart';
const context = (userId: string) => `downloader-login:${userId}:deviantart`;

const AUTHORIZE_URL = 'https://www.deviantart.com/oauth2/authorize';
const TOKEN_URL = 'https://www.deviantart.com/oauth2/token';
const WHOAMI_URL = 'https://www.deviantart.com/api/v1/oauth2/user/whoami';
/**
 * gallery-dl's own redirect page (it only forwards to http://localhost:6414/).
 * The same address goes into the app's "Redirect URI Whitelist". It works
 * without HTTPS on Conbert: the code is copied from the address bar.
 */
export const DEVIANTART_REDIRECT_URI = 'https://mikf.github.io/gallery-dl/oauth-redirect.html';
/** Browse galleries and favourites, read the own user name. */
const SCOPE = 'browse user';

const LOGIN_TTL_MS = 15 * 60_000;
const pending = new Map<string, { verifier: string; state: string; expires: number }>();

interface StoredApp {
  clientId: string;
  clientSecret: string;
  refreshToken: string | null;
  name: string | null;
}

const base64url = (b: Buffer) => b.toString('base64url');

/** Client IDs are numbers, secrets 32 hex digits (as DeviantArt shows them). */
export function isDeviantartApp(clientId: string, clientSecret: string): boolean {
  return /^\d{1,12}$/.test(clientId.trim()) && /^[0-9a-f]{32}$/i.test(clientSecret.trim());
}

/** "http://localhost:6414/?code=abc&state=x", "code=abc" or just "abc" → code and state. */
export function parseDeviantartCode(input: string): { code: string; state: string | null } | null {
  const text = input.trim();
  const code = /[?&\s'"]?code=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? text;
  const state = /[?&]state=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? null;
  return /^[A-Za-z0-9_-]{8,500}$/.test(code) ? { code, state } : null;
}

/** DeviantArt's own words about an error, for "show details" (never a token). */
function describeError(data: Record<string, unknown>): string {
  const words = [data['error'], data['error_description']]
    .filter((w): w is string => typeof w === 'string')
    .map((w) => w.slice(0, 200));
  return words.length > 0 ? `: ${words.join(' – ')}` : '';
}

function basicAuth(app: Pick<StoredApp, 'clientId' | 'clientSecret'>): string {
  return `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`;
}

async function tokenRequest(
  app: Pick<StoredApp, 'clientId' | 'clientSecret'>,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ response: Response; data: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(app),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new HttpError(502, 'DEVIANTART_LOGIN_FAILED', String(error));
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { response, data };
}

/** gallery-dl keeps DeviantArt's access tokens in its cache – they belong to the old app. */
async function clearToolCache(ctx: AppContext, userId: string): Promise<void> {
  await runProcess(
    toolPath(ctx.config, 'gallery-dl'),
    ['--config-ignore', '--clear-cache', 'deviantart'],
    { timeoutMs: 30_000, env: toolEnv(toolHome(ctx.config, userId)) },
  ).catch(() => undefined);
}

/**
 * Saves your own app after DeviantArt accepted it (a quick token request).
 * A login of an earlier app ends: its token only works with that app.
 */
export async function saveDeviantartApp(
  ctx: AppContext,
  userId: string,
  input: { clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): Promise<DeviantartStatus> {
  const app = { clientId: input.clientId.trim(), clientSecret: input.clientSecret.trim() };
  if (!isDeviantartApp(app.clientId, app.clientSecret)) {
    throw new HttpError(400, 'DEVIANTART_APP_INVALID');
  }
  const { response, data } = await tokenRequest(
    app,
    { grant_type: 'client_credentials' },
    fetchImpl,
  );
  if (!response.ok || typeof data['access_token'] !== 'string') {
    // DeviantArt answers an unknown app with an error (even with status 500).
    const details = `HTTP ${response.status}${describeError(data)}`;
    if (typeof data['error'] === 'string' || response.status === 400 || response.status === 401) {
      throw new HttpError(400, 'DEVIANTART_APP_REFUSED', details);
    }
    throw new HttpError(502, 'DEVIANTART_LOGIN_FAILED', details);
  }
  const before = load(ctx, userId);
  const same = before?.clientId === app.clientId && before.clientSecret === app.clientSecret;
  store(ctx, userId, {
    ...app,
    refreshToken: same ? before.refreshToken : null,
    name: same ? before.name : null,
  });
  pending.delete(userId);
  if (!same) await clearToolCache(ctx, userId);
  return deviantartStatus(ctx, userId);
}

/** Step 1 of the login: DeviantArt's own login page, with PKCE and a state. */
export function startDeviantartLogin(ctx: AppContext, userId: string, now = Date.now()): string {
  const app = load(ctx, userId);
  if (!app) throw new HttpError(400, 'DEVIANTART_APP_MISSING');
  for (const [key, entry] of pending) if (entry.expires < now) pending.delete(key);
  const verifier = base64url(randomBytes(32));
  const state = base64url(randomBytes(16));
  pending.set(userId, { verifier, state, expires: now + LOGIN_TTL_MS });
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', app.clientId);
  url.searchParams.set('redirect_uri', DEVIANTART_REDIRECT_URI);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', base64url(createHash('sha256').update(verifier).digest()));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.href;
}

/** Step 2: swap the code from the address bar for a refresh token and keep it. */
export async function finishDeviantartLogin(
  ctx: AppContext,
  userId: string,
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviantartStatus> {
  const parsed = parseDeviantartCode(input);
  if (!parsed) throw new HttpError(400, 'DEVIANTART_CODE_INVALID');
  const app = load(ctx, userId);
  if (!app) throw new HttpError(400, 'DEVIANTART_APP_MISSING');
  const started = pending.get(userId);
  if (!started || started.expires < Date.now()) {
    throw new HttpError(400, 'DEVIANTART_LOGIN_EXPIRED');
  }
  // An address from an older login tab belongs to another attempt.
  if (parsed.state !== null && parsed.state !== started.state) {
    throw new HttpError(400, 'DEVIANTART_LOGIN_EXPIRED');
  }
  const { response, data } = await tokenRequest(
    app,
    {
      grant_type: 'authorization_code',
      code: parsed.code,
      redirect_uri: DEVIANTART_REDIRECT_URI,
      code_verifier: started.verifier,
    },
    fetchImpl,
  );
  if (!response.ok || typeof data['refresh_token'] !== 'string') {
    if (data['error'] === 'invalid_grant' || data['error'] === 'invalid_request') {
      throw new HttpError(400, 'DEVIANTART_CODE_EXPIRED');
    }
    throw new HttpError(
      502,
      'DEVIANTART_LOGIN_FAILED',
      `HTTP ${response.status}${describeError(data)}`,
    );
  }
  pending.delete(userId);
  const name =
    typeof data['access_token'] === 'string' ? await whoami(data['access_token'], fetchImpl) : null;
  store(ctx, userId, { ...app, refreshToken: data['refresh_token'], name });
  return deviantartStatus(ctx, userId);
}

/** The account's user name – only for the settings ("connected as …"). */
async function whoami(accessToken: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(WHOAMI_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json()) as { username?: unknown };
    return typeof data.username === 'string' ? data.username.slice(0, 80) : null;
  } catch {
    return null;
  }
}

function store(ctx: AppContext, userId: string, app: StoredApp) {
  const values = {
    content: ctx.secrets.encrypt(JSON.stringify(app), context(userId)),
    updatedAt: new Date(),
  };
  ctx.db
    .insert(downloaderCookies)
    .values({ userId, platform: PLATFORM, ...values })
    .onConflictDoUpdate({
      target: [downloaderCookies.userId, downloaderCookies.platform],
      set: values,
    })
    .run();
}

function load(ctx: AppContext, userId: string): (StoredApp & { updatedAt: Date }) | null {
  const row = ctx.db
    .select()
    .from(downloaderCookies)
    .where(and(eq(downloaderCookies.userId, userId), eq(downloaderCookies.platform, PLATFORM)))
    .get();
  if (!row) return null;
  try {
    const app = JSON.parse(ctx.secrets.decrypt(row.content, context(userId))) as StoredApp;
    return typeof app.clientId === 'string' && typeof app.clientSecret === 'string'
      ? { ...app, updatedAt: row.updatedAt }
      : null;
  } catch {
    // Key changed: as if nothing were set up (the UI asks again).
    return null;
  }
}

export function deviantartStatus(ctx: AppContext, userId: string): DeviantartStatus {
  const app = load(ctx, userId);
  return {
    hasApp: app !== null,
    clientId: app?.clientId ?? null,
    connected: Boolean(app?.refreshToken),
    name: app?.name ?? null,
    updatedAt: app?.updatedAt.toISOString() ?? null,
  };
}

export function hasDeviantartLogin(ctx: AppContext, userId: string): boolean {
  return Boolean(load(ctx, userId)?.refreshToken);
}

/** Logs out (the app stays), or forgets everything with `everything`. */
export async function deleteDeviantart(
  ctx: AppContext,
  userId: string,
  everything: boolean,
): Promise<void> {
  pending.delete(userId);
  const app = load(ctx, userId);
  if (app && !everything) {
    store(ctx, userId, { ...app, refreshToken: null, name: null });
  } else {
    ctx.db
      .delete(downloaderCookies)
      .where(and(eq(downloaderCookies.userId, userId), eq(downloaderCookies.platform, PLATFORM)))
      .run();
  }
  await clearToolCache(ctx, userId);
}

/**
 * A private gallery-dl config file with the app (and token), for one run –
 * not on the command line, where other processes could read it.
 */
export async function deviantartConfigFile(
  ctx: AppContext,
  userId: string,
  folder: string,
): Promise<{ file: string | null; remove: () => Promise<void> }> {
  const app = load(ctx, userId);
  if (!app) return { file: null, remove: async () => undefined };
  const file = path.join(folder, `cookies-deviantart-${randomUUID()}.json`);
  const config = {
    extractor: {
      deviantart: {
        'client-id': app.clientId,
        'client-secret': app.clientSecret,
        ...(app.refreshToken && { 'refresh-token': app.refreshToken }),
      },
    },
  };
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  return { file, remove: () => rm(file, { force: true }) };
}
