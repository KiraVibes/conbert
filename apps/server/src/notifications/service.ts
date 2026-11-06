import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { z } from 'zod';
import { getMessage, isLanguage, type Language } from '@conbert/i18n';
import type { ChannelDto, NotificationDto, channelRequestSchema } from '@conbert/schemas';
import { checkedUrl } from '../booru/http';
import { publicFetch } from '../lib/public-net';
import type { AppContext } from '../context';
import {
  notificationChannels,
  userSettings,
  users,
  type NotificationChannelRecord,
} from '../db/schema';
import { HttpError } from '../lib/http-error';

/**
 * Notifications: browser (over the WebSocket), ntfy, Gotify, Discord,
 * Telegram and e-mail. Secrets (tokens, webhook addresses, passwords) are
 * stored encrypted and never sent back.
 */

type ChannelInput = z.infer<typeof channelRequestSchema>;
type ChannelType = ChannelDto['type'];

/** Which fields are secret per type, and which are required. */
const SECRET_FIELDS: Record<ChannelType, string[]> = {
  browser: [],
  ntfy: ['token'],
  gotify: ['token'],
  discord: ['webhookUrl'],
  telegram: ['botToken'],
  email: ['password'],
};
const REQUIRED: Record<ChannelType, string[]> = {
  browser: [],
  ntfy: ['topic'],
  gotify: ['server', 'token'],
  discord: ['webhookUrl'],
  telegram: ['botToken', 'chatId'],
  email: ['host', 'from', 'to'],
};

const secretContext = (userId: string, id: string) => `notification:${userId}:${id}`;

export function toChannelDto(ctx: AppContext, row: NotificationChannelRecord): ChannelDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ChannelType,
    settings: row.settings as Record<string, string>,
    storedSecrets: Object.keys(readSecrets(ctx, row)).filter((k) => readSecrets(ctx, row)[k]),
    events: row.events as ChannelDto['events'],
    createdAt: row.createdAt.toISOString(),
  };
}

function readSecrets(ctx: AppContext, row: NotificationChannelRecord): Record<string, string> {
  if (!row.secrets) return {};
  try {
    return JSON.parse(
      ctx.secrets.decrypt(row.secrets, secretContext(row.userId, row.id)),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

export function listChannels(ctx: AppContext, userId: string): ChannelDto[] {
  return ctx.db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.userId, userId))
    .all()
    .map((row) => toChannelDto(ctx, row));
}

export function ownChannel(ctx: AppContext, userId: string, id: string): NotificationChannelRecord {
  const row = ctx.db
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.id, id), eq(notificationChannels.userId, userId)))
    .get();
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  return row;
}

function isAdmin(ctx: AppContext, userId: string): boolean {
  return (
    ctx.db.select({ role: users.role }).from(users).where(eq(users.id, userId)).get()?.role ===
    'admin'
  );
}

/** Addresses are checked: home-network servers (own ntfy/Gotify) only for admins. */
function checkAddresses(
  ctx: AppContext,
  userId: string,
  type: ChannelType,
  all: Record<string, string>,
) {
  const allowPrivate = isAdmin(ctx, userId);
  const check = (value: string | undefined) => {
    if (value && !checkedUrl(value, allowPrivate))
      throw new HttpError(422, 'NOTIFY_ADDRESS_INVALID');
  };
  if (type === 'ntfy' || type === 'gotify') check(all['server']);
  if (type === 'discord') {
    const url = checkedUrl(all['webhookUrl'] ?? '', false);
    if (
      !url ||
      !/^(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)$/.test(url.hostname)
    ) {
      throw new HttpError(422, 'NOTIFY_ADDRESS_INVALID');
    }
  }
}

function save(
  ctx: AppContext,
  userId: string,
  id: string,
  input: ChannelInput,
  existing?: Record<string, string>,
) {
  const secrets = { ...existing };
  for (const field of SECRET_FIELDS[input.type]) {
    const value = input.secrets[field]?.trim();
    if (value) secrets[field] = value;
  }
  const settings = Object.fromEntries(
    Object.entries(input.settings)
      .map(([k, v]) => [k, v.trim()] as const)
      .filter(([k, v]) => v !== '' && !SECRET_FIELDS[input.type].includes(k)),
  );
  const all = { ...settings, ...secrets };
  const missing = REQUIRED[input.type].filter((f) => !all[f]);
  if (missing.length > 0) throw new HttpError(422, 'NOTIFY_FIELD_MISSING', missing.join(', '));
  checkAddresses(ctx, userId, input.type, all);
  return {
    name: input.name,
    type: input.type,
    settings,
    secrets:
      Object.keys(secrets).length > 0
        ? ctx.secrets.encrypt(JSON.stringify(secrets), secretContext(userId, id))
        : null,
    events: input.events,
  };
}

export function createChannel(ctx: AppContext, userId: string, input: ChannelInput): ChannelDto {
  const id = randomUUID();
  ctx.db
    .insert(notificationChannels)
    .values({ id, userId, ...save(ctx, userId, id, input) })
    .run();
  return toChannelDto(ctx, ownChannel(ctx, userId, id));
}

export function updateChannel(
  ctx: AppContext,
  userId: string,
  id: string,
  input: ChannelInput,
): ChannelDto {
  const row = ownChannel(ctx, userId, id);
  const existing = row.type === input.type ? readSecrets(ctx, row) : {};
  ctx.db
    .update(notificationChannels)
    .set(save(ctx, userId, id, input, existing))
    .where(eq(notificationChannels.id, id))
    .run();
  return toChannelDto(ctx, ownChannel(ctx, userId, id));
}

export function deleteChannel(ctx: AppContext, userId: string, id: string): void {
  ownChannel(ctx, userId, id);
  ctx.db.delete(notificationChannels).where(eq(notificationChannels.id, id)).run();
}

// --- Sending ---

function languageOf(ctx: AppContext, userId: string): Language {
  const data = ctx.db.select().from(userSettings).where(eq(userSettings.userId, userId)).get()
    ?.data as { language?: unknown } | undefined;
  return isLanguage(data?.language) ? data.language : 'de';
}

export function renderText(
  language: Language,
  key: string,
  values: NotificationDto['values'],
): string {
  const template = getMessage(language, key) ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(values[name] ?? ''));
}

async function post(url: string, init: RequestInit, allowPrivate: boolean): Promise<void> {
  const address = checkedUrl(url, allowPrivate);
  if (!address) throw new Error('address');
  // Webhooks in the home network only for admins (checkedUrl); otherwise the
  // address is checked again when connecting (names pointing to private IPs).
  const res = await (allowPrivate ? fetch : publicFetch)(address, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok)
    throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

async function deliver(
  ctx: AppContext,
  row: NotificationChannelRecord,
  title: string,
  body: string,
  notification: NotificationDto,
): Promise<void> {
  const s = row.settings as Record<string, string>;
  const secret = readSecrets(ctx, row);
  const allowPrivate = isAdmin(ctx, row.userId);
  switch (row.type as ChannelType) {
    case 'browser':
      ctx.jobs.events.emit('notification', row.userId, notification);
      return;
    case 'ntfy': {
      const server = (s['server'] || 'https://ntfy.sh').replace(/\/+$/, '');
      return post(
        `${server}/${encodeURIComponent(s['topic'] ?? '')}`,
        {
          method: 'POST',
          // ntfy reads the title from a header – only plain characters there.
          headers: {
            Title: title.replace(/[^\x20-\x7e]/g, '?'),
            ...(secret['token'] && { Authorization: `Bearer ${secret['token']}` }),
          },
          body,
        },
        allowPrivate,
      );
    }
    case 'gotify': {
      const server = (s['server'] ?? '').replace(/\/+$/, '');
      return post(
        `${server}/message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Gotify-Key': secret['token'] ?? '' },
          body: JSON.stringify({ title, message: body, priority: 5 }),
        },
        allowPrivate,
      );
    }
    case 'discord':
      return post(
        secret['webhookUrl'] ?? '',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `**${title}**\n${body}`.slice(0, 1900) }),
        },
        false,
      );
    case 'telegram':
      return post(
        `https://api.telegram.org/bot${secret['botToken'] ?? ''}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: s['chatId'], text: `${title}\n${body}` }),
        },
        false,
      );
    case 'email': {
      const port = Number(s['port'] || (s['security'] === 'tls' ? 465 : 587));
      const transport = nodemailer.createTransport({
        host: s['host'],
        port,
        secure: s['security'] === 'tls',
        ignoreTLS: s['security'] === 'none',
        requireTLS: s['security'] !== 'none' && s['security'] !== 'tls',
        ...(s['user'] && { auth: { user: s['user'], pass: secret['password'] ?? '' } }),
        connectionTimeout: 15_000,
      });
      await transport.sendMail({ from: s['from'], to: s['to'], subject: title, text: body });
      return;
    }
  }
}

/**
 * Sends a notification to all channels of the user that want this event
 * (or only to the given channels). Failures are logged, never thrown.
 */
export async function notify(
  ctx: AppContext,
  userId: string,
  notification: NotificationDto,
  options: { channelIds?: string[]; log?: { warn: (o: object, m: string) => void } } = {},
): Promise<void> {
  const rows = ctx.db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.userId, userId))
    .all()
    .filter((row) =>
      options.channelIds
        ? options.channelIds.includes(row.id)
        : (row.events as string[]).includes(notification.event),
    );
  if (rows.length === 0) return;
  const language = languageOf(ctx, userId);
  const title = renderText(language, notification.titleKey, notification.values);
  const body = renderText(language, notification.bodyKey, notification.values);
  await Promise.all(
    rows.map((row) =>
      deliver(ctx, row, title, body, notification).catch((err: unknown) =>
        options.log?.warn({ err, channel: row.id }, 'notification failed'),
      ),
    ),
  );
}

/** "Testen" in the settings: sends one message, errors are reported. */
export async function testChannel(ctx: AppContext, userId: string, id: string): Promise<void> {
  const row = ownChannel(ctx, userId, id);
  const notification: NotificationDto = {
    event: 'batch-done',
    titleKey: 'notifications.testMessage.title',
    bodyKey: 'notifications.testMessage.body',
    values: {},
  };
  const language = languageOf(ctx, userId);
  try {
    await deliver(
      ctx,
      row,
      renderText(language, notification.titleKey, {}),
      renderText(language, notification.bodyKey, {}),
      notification,
    );
  } catch (error) {
    throw new HttpError(
      502,
      'NOTIFY_FAILED',
      error instanceof Error ? error.message.slice(0, 300) : undefined,
    );
  }
}
