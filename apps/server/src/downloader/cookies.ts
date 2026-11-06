import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { COOKIE_PLATFORMS } from '@conbert/core';
import type { AppContext } from '../context';
import { downloaderCookies } from '../db/schema';
import { HttpError } from '../lib/http-error';

/**
 * cookies.txt per user and platform (for private or login-only content).
 * Stored encrypted, never logged, never sent back – the tools only get a
 * temporary file that is deleted right after.
 */

const context = (userId: string, platform: string) => `downloader-cookies:${userId}:${platform}`;
/** The table also holds the Pixiv login (see pixiv.ts) – that one is no cookie file. */
const isCookiePlatform = (p: string) => (COOKIE_PLATFORMS as readonly string[]).includes(p);

/** Netscape format: comments, or 7 tab-separated fields per cookie. */
export function isCookiesTxt(content: string): boolean {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  const cookies = lines.filter((l) => !l.startsWith('#') || l.startsWith('#HttpOnly_'));
  return cookies.length > 0 && cookies.every((l) => l.split('\t').length === 7);
}

export function saveCookies(ctx: AppContext, userId: string, platform: string, content: string) {
  if (!isCookiesTxt(content)) throw new HttpError(400, 'DOWNLOAD_COOKIES_INVALID');
  // The tools want this first line; browser extensions sometimes leave it out.
  const text = content.startsWith('# Netscape HTTP Cookie File')
    ? content
    : `# Netscape HTTP Cookie File\n${content}`;
  const values = {
    content: ctx.secrets.encrypt(text, context(userId, platform)),
    updatedAt: new Date(),
  };
  ctx.db
    .insert(downloaderCookies)
    .values({ userId, platform, ...values })
    .onConflictDoUpdate({
      target: [downloaderCookies.userId, downloaderCookies.platform],
      set: values,
    })
    .run();
}

export function deleteCookies(ctx: AppContext, userId: string, platform: string) {
  ctx.db
    .delete(downloaderCookies)
    .where(and(eq(downloaderCookies.userId, userId), eq(downloaderCookies.platform, platform)))
    .run();
}

export function listCookies(ctx: AppContext, userId: string) {
  return ctx.db
    .select({ platform: downloaderCookies.platform, updatedAt: downloaderCookies.updatedAt })
    .from(downloaderCookies)
    .where(eq(downloaderCookies.userId, userId))
    .all()
    .filter((c) => isCookiePlatform(c.platform));
}

export function hasCookies(ctx: AppContext, userId: string, platform: string): boolean {
  return listCookies(ctx, userId).some((c) => c.platform === platform);
}

/**
 * Writes the cookies to a private temporary file for one run of a tool.
 * Returns its path (or null) and a function that deletes it again.
 */
export async function cookieFile(
  ctx: AppContext,
  userId: string,
  platform: string,
  folder: string,
): Promise<{ file: string | null; remove: () => Promise<void> }> {
  if (!isCookiePlatform(platform)) return { file: null, remove: async () => undefined };
  const row = ctx.db
    .select()
    .from(downloaderCookies)
    .where(and(eq(downloaderCookies.userId, userId), eq(downloaderCookies.platform, platform)))
    .get();
  if (!row) return { file: null, remove: async () => undefined };
  let text: string;
  try {
    text = ctx.secrets.decrypt(row.content, context(userId, platform));
  } catch {
    // Key changed: behave as if there were no cookies (the UI asks to upload again).
    return { file: null, remove: async () => undefined };
  }
  const file = path.join(folder, `cookies-${randomUUID()}.txt`);
  await writeFile(file, text, { mode: 0o600 });
  return { file, remove: () => rm(file, { force: true }) };
}
