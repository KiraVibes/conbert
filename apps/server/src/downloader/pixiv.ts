import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { PixivLoginStatus } from '@conbert/schemas';
import type { AppContext } from '../context';
import { downloaderCookies } from '../db/schema';
import { HttpError } from '../lib/http-error';

/**
 * Pixiv login. gallery-dl talks to Pixiv's app API, which wants a refresh
 * token instead of cookies. People log in on Pixiv's own page (Conbert never
 * sees the password) and paste the one-time code they get back; the server
 * swaps it for the token – the same steps as `gallery-dl oauth:pixiv`.
 *
 * The token sits in the cookies table (row "pixiv"), encrypted under its own
 * context, never logged and never sent back.
 */

const PLATFORM = 'pixiv';
const context = (userId: string) => `downloader-login:${userId}:pixiv`;

// The public client of Pixiv's Android app – every Pixiv tool (gallery-dl,
// pixivpy …) logs in as this app, the API knows no other way.
const CLIENT_ID = 'MOBrBDS8blbauoSck0ZfDbtuzpyT';
const CLIENT_SECRET = 'lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj';
const LOGIN_URL = 'https://app-api.pixiv.net/web/v1/login';
const TOKEN_URL = 'https://oauth.secure.pixiv.net/auth/token';
const REDIRECT_URI = 'https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback';
const USER_AGENT = 'PixivAndroidApp/5.0.234 (Android 11; Pixel 5)';

/** A started login waits this long for its code (the code itself lasts 30 s). */
const LOGIN_TTL_MS = 15 * 60_000;
const pending = new Map<string, { verifier: string; expires: number }>();

interface StoredLogin {
  refreshToken: string;
  name: string | null;
}

const base64url = (b: Buffer) => b.toString('base64url');

/** Step 1: the address of Pixiv's login page, with a fresh PKCE challenge. */
export function startPixivLogin(userId: string, now = Date.now()): string {
  for (const [key, entry] of pending) if (entry.expires < now) pending.delete(key);
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  pending.set(userId, { verifier, expires: now + LOGIN_TTL_MS });
  const url = new URL(LOGIN_URL);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('client', 'pixiv-android');
  return url.href;
}

/** "pixiv://account/login?code=abc&via=login", "code=abc" or just "abc" → "abc". */
export function parsePixivCode(input: string): string | null {
  const text = input.trim();
  const fromParam = /[?&\s'"]?code=([A-Za-z0-9_-]+)/.exec(text)?.[1];
  const code = fromParam ?? text;
  return /^[A-Za-z0-9_-]{8,200}$/.test(code) ? code : null;
}

/** A refresh token as Pixiv hands it out (letters, digits, - and _). */
export function isPixivToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{20,200}$/.test(token.trim());
}

/** Step 2: swap the one-time code for a refresh token and keep it. */
export async function finishPixivLogin(
  ctx: AppContext,
  userId: string,
  input: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PixivLoginStatus> {
  const code = parsePixivCode(input);
  if (!code) throw new HttpError(400, 'PIXIV_CODE_INVALID');
  const started = pending.get(userId);
  if (!started || started.expires < Date.now()) throw new HttpError(400, 'PIXIV_LOGIN_EXPIRED');
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        code_verifier: started.verifier,
        grant_type: 'authorization_code',
        include_policy: 'true',
        redirect_uri: REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new HttpError(502, 'PIXIV_LOGIN_FAILED', String(error));
  }
  const data = (await response.json().catch(() => ({}))) as {
    refresh_token?: unknown;
    user?: { name?: unknown };
    error?: unknown;
  };
  if (!response.ok || typeof data.refresh_token !== 'string') {
    // The code only lasts 30 seconds after logging in.
    if (data.error === 'invalid_grant' || data.error === 'invalid_request') {
      throw new HttpError(400, 'PIXIV_CODE_EXPIRED');
    }
    throw new HttpError(502, 'PIXIV_LOGIN_FAILED', `HTTP ${response.status}`);
  }
  pending.delete(userId);
  const name = typeof data.user?.name === 'string' ? data.user.name.slice(0, 80) : null;
  store(ctx, userId, { refreshToken: data.refresh_token, name });
  return pixivStatus(ctx, userId);
}

/** For people who already have a token (e.g. from `gallery-dl oauth:pixiv`). */
export function savePixivToken(ctx: AppContext, userId: string, token: string): PixivLoginStatus {
  if (!isPixivToken(token)) throw new HttpError(400, 'PIXIV_TOKEN_INVALID');
  store(ctx, userId, { refreshToken: token.trim(), name: null });
  return pixivStatus(ctx, userId);
}

function store(ctx: AppContext, userId: string, login: StoredLogin) {
  const values = {
    content: ctx.secrets.encrypt(JSON.stringify(login), context(userId)),
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

function load(ctx: AppContext, userId: string): (StoredLogin & { updatedAt: Date }) | null {
  const row = ctx.db
    .select()
    .from(downloaderCookies)
    .where(and(eq(downloaderCookies.userId, userId), eq(downloaderCookies.platform, PLATFORM)))
    .get();
  if (!row) return null;
  try {
    const login = JSON.parse(ctx.secrets.decrypt(row.content, context(userId))) as StoredLogin;
    return typeof login.refreshToken === 'string' ? { ...login, updatedAt: row.updatedAt } : null;
  } catch {
    // Key changed: as if not connected (the UI asks to log in again).
    return null;
  }
}

export function pixivStatus(ctx: AppContext, userId: string): PixivLoginStatus {
  const login = load(ctx, userId);
  return {
    connected: login !== null,
    name: login?.name ?? null,
    updatedAt: login?.updatedAt.toISOString() ?? null,
  };
}

export function hasPixivLogin(ctx: AppContext, userId: string): boolean {
  return load(ctx, userId) !== null;
}

export function deletePixivLogin(ctx: AppContext, userId: string) {
  pending.delete(userId);
  ctx.db
    .delete(downloaderCookies)
    .where(and(eq(downloaderCookies.userId, userId), eq(downloaderCookies.platform, PLATFORM)))
    .run();
}

/**
 * A private gallery-dl config file with the token, for one run (not on the
 * command line, where other processes could read it). Deleted right after.
 */
export async function pixivConfigFile(
  ctx: AppContext,
  userId: string,
  folder: string,
): Promise<{ file: string | null; remove: () => Promise<void> }> {
  const login = load(ctx, userId);
  if (!login) return { file: null, remove: async () => undefined };
  const file = path.join(folder, `cookies-pixiv-${randomUUID()}.json`);
  const config = { extractor: { pixiv: { 'refresh-token': login.refreshToken } } };
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  return { file, remove: () => rm(file, { force: true }) };
}
