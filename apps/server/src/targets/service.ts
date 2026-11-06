import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import {
  STORAGE_FIELDS,
  STORAGE_TYPES,
  StoragePathError,
  joinStoragePath,
  normalizeBasePath,
  normalizeRelativePath,
  parseSmbAddress,
  secretFields,
  type SupportedStorageType,
} from '@conbert/core';
import type { SaveTargetRequest, StorageTargetDto } from '@conbert/schemas';
import { saveTargetRequestSchema } from '@conbert/schemas';
import type { AppContext } from '../context';
import { storageTargets, type StorageTargetRecord } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { SecretBoxError } from '../lib/secret-box';
import { RcloneConnection, rcloneObscure, REMOTE, StorageError, type RcloneRemote } from './rclone';

type SaveTarget = ReturnType<typeof saveTargetRequestSchema.parse>;
type Settings = Record<string, string | number | boolean>;

/** A location with its secrets decrypted – only ever kept in memory. */
export interface ResolvedTarget {
  type: SupportedStorageType;
  basePath: string;
  settings: Settings;
  secrets: Record<string, string>;
}

const isSupported = (type: string): type is SupportedStorageType =>
  (STORAGE_TYPES as readonly string[]).includes(type);

/** Binds the encrypted secrets to their owner and row. */
const secretContext = (userId: string, id: string) => `storage-target:${userId}:${id}`;

export function toTargetDto(record: StorageTargetRecord): StorageTargetDto {
  let stored: string[] = [];
  if (record.secrets) {
    // Only the names of stored secrets are known without decrypting – they are kept beside it.
    const settings = record.settings as Settings;
    stored = String(settings['__secretKeys'] ?? '')
      .split(',')
      .filter(Boolean);
  }
  const { __secretKeys: _hidden, ...settings } = record.settings as Settings;
  return {
    id: record.id,
    name: record.name,
    type: isSupported(record.type) ? record.type : 'local',
    basePath: record.basePath,
    usage: { asTarget: record.asTarget, asSource: record.asSource },
    conflictPolicy: record.conflictPolicy,
    subfolderPattern: record.subfolderPattern,
    isDefault: record.isDefault,
    settings,
    storedSecrets: stored,
  };
}

export function getOwnTarget(ctx: AppContext, userId: string, id: string): StorageTargetRecord {
  const record = ctx.db
    .select()
    .from(storageTargets)
    .where(and(eq(storageTargets.id, id), eq(storageTargets.userId, userId)))
    .get();
  if (!record) throw new HttpError(404, 'NOT_FOUND');
  return record;
}

function decryptSecrets(ctx: AppContext, record: StorageTargetRecord): Record<string, string> {
  if (!record.secrets) return {};
  try {
    return JSON.parse(
      ctx.secrets.decrypt(record.secrets, secretContext(record.userId, record.id)),
    ) as Record<string, string>;
  } catch (error) {
    if (error instanceof SecretBoxError) {
      throw new HttpError(422, 'STORAGE_SECRET_LOST', record.name);
    }
    throw error;
  }
}

export function resolveRecord(ctx: AppContext, record: StorageTargetRecord): ResolvedTarget {
  if (!isSupported(record.type)) throw new HttpError(422, 'BAD_REQUEST', record.type);
  const { __secretKeys: _hidden, ...settings } = record.settings as Settings;
  return {
    type: record.type,
    basePath: record.basePath,
    settings,
    secrets: decryptSecrets(ctx, record),
  };
}

const text = (s: Settings, key: string): string => {
  const v = s[key];
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
};

/**
 * Checks a save request and splits it into what is stored openly and what is
 * encrypted. `previous` keeps secrets the browser didn't send again.
 */
export function validateTarget(
  ctx: AppContext,
  input: SaveTarget,
  previousSecrets: Record<string, string> = {},
): ResolvedTarget {
  if (!isSupported(input.type)) throw new HttpError(422, 'STORAGE_TYPE_UNSUPPORTED', input.type);
  const fields = STORAGE_FIELDS[input.type];
  const settings: Settings = {};
  const secrets: Record<string, string> = {};
  for (const field of fields) {
    if (field.secret) {
      const sent = input.secrets[field.key];
      const value = sent === undefined ? previousSecrets[field.key] : sent;
      if (value) secrets[field.key] = value;
      continue;
    }
    const raw = input.settings[field.key] ?? field.default;
    if (raw === undefined || raw === '') continue;
    if (field.type === 'number') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new HttpError(400, 'BAD_REQUEST', field.key);
      }
      settings[field.key] = n;
    } else if (field.type === 'boolean') {
      settings[field.key] = raw === true || raw === 'true';
    } else if (field.type === 'select') {
      if (!field.choices?.some((c) => c.value === raw)) {
        throw new HttpError(400, 'BAD_REQUEST', field.key);
      }
      settings[field.key] = String(raw);
    } else {
      const value = String(raw).trim();
      // eslint-disable-next-line no-control-regex -- no control characters in host names, URLs …
      if (/[\u0000-\u001f\u007f]/.test(value)) throw new HttpError(400, 'BAD_REQUEST', field.key);
      settings[field.key] = value;
    }
  }
  for (const field of fields) {
    const present = field.secret ? Boolean(secrets[field.key]) : settings[field.key] !== undefined;
    if (field.required && !present) throw new HttpError(400, 'STORAGE_FIELD_MISSING', field.key);
  }
  if (input.type === 'smb' && !parseSmbAddress(text(settings, 'address'))) {
    throw new HttpError(400, 'STORAGE_ADDRESS_INVALID', text(settings, 'address'));
  }
  if (input.type === 'webdav' && !/^https?:\/\/[^\s/]+/i.test(text(settings, 'url'))) {
    throw new HttpError(400, 'STORAGE_ADDRESS_INVALID', text(settings, 'url'));
  }
  if (input.type === 's3') {
    const endpoint = text(settings, 'endpoint');
    if (endpoint && !/^https?:\/\/[^\s/]+/i.test(endpoint)) {
      throw new HttpError(400, 'STORAGE_ADDRESS_INVALID', endpoint);
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,62}$/i.test(text(settings, 'bucket'))) {
      throw new HttpError(400, 'STORAGE_ADDRESS_INVALID', text(settings, 'bucket'));
    }
  }
  if (input.type === 'sftp' && !secrets['password'] && !secrets['privateKey']) {
    throw new HttpError(400, 'STORAGE_FIELD_MISSING', 'password');
  }
  if (input.type === 'local' && !ctx.config.storageRoots.includes(text(settings, 'root'))) {
    throw new HttpError(422, 'STORAGE_ROOT_NOT_ALLOWED', text(settings, 'root'));
  }
  let basePath: string;
  try {
    basePath = normalizeBasePath(input.basePath);
  } catch {
    throw new HttpError(400, 'STORAGE_PATH_INVALID', input.basePath);
  }
  // Local folders, S3 buckets and SMB shares: the base folder is always inside.
  if (['local', 's3', 'smb'].includes(input.type)) basePath = basePath.replace(/^\/+/, '');
  return { type: input.type, basePath, settings, secrets };
}

/** The location as rclone settings (secrets only in the returned object, never logged). */
export function rcloneRemote(target: ResolvedTarget): RcloneRemote {
  const s = target.settings;
  const secret = (key: string) => target.secrets[key] ?? '';
  const options: Record<string, string> = { type: target.type };
  const set = (key: string, value: string | undefined) => {
    if (value) options[key] = value;
  };
  const pass = secret('password') ? rcloneObscure(secret('password')) : undefined;
  let rootPath = target.basePath;
  switch (target.type) {
    case 'smb': {
      const address = parseSmbAddress(text(s, 'address'));
      if (!address) throw new HttpError(400, 'STORAGE_ADDRESS_INVALID');
      set('host', address.host);
      set('user', text(s, 'user'));
      set('pass', pass);
      set('domain', text(s, 'domain'));
      set('port', text(s, 'port'));
      rootPath = joinStoragePath(address.share, address.path, target.basePath);
      break;
    }
    case 'sftp':
      set('host', text(s, 'host'));
      set('user', text(s, 'user'));
      set('pass', pass);
      set('port', text(s, 'port'));
      // rclone wants the key on one line with "\n" in place of line breaks.
      set('key_pem', secret('privateKey').trim().replace(/\r?\n/g, '\\n'));
      // Don't run commands (md5sum …) on the other machine.
      set('shell_type', 'none');
      break;
    case 'ftp': {
      set('host', text(s, 'host'));
      set('user', text(s, 'user'));
      set('pass', pass);
      set('port', text(s, 'port'));
      const security = text(s, 'security') || 'explicit';
      if (security === 'explicit') set('explicit_tls', 'true');
      if (security === 'implicit') set('tls', 'true');
      if (s['skipCertificateCheck'] === true) set('no_check_certificate', 'true');
      break;
    }
    case 'webdav':
      set('url', text(s, 'url'));
      set('vendor', text(s, 'vendor') || 'other');
      set('user', text(s, 'user'));
      set('pass', pass);
      break;
    case 's3':
      set('provider', text(s, 'provider') || 'Other');
      set('access_key_id', text(s, 'accessKeyId'));
      set('secret_access_key', secret('secretAccessKey'));
      set('endpoint', text(s, 'endpoint'));
      set('region', text(s, 'region'));
      // Never try to create the bucket; saving only needs write access to it.
      set('no_check_bucket', 'true');
      rootPath = joinStoragePath(text(s, 'bucket'), target.basePath);
      break;
    case 'local':
      // Symlinks are skipped by rclone; see assertInsideRoot for the path itself.
      rootPath = path.posix.join(text(s, 'root'), target.basePath);
      break;
  }
  return { options, root: `${REMOTE}:${rootPath}` };
}

/**
 * Local folders: the real path (after following symlinks) must stay inside the
 * allowed root. Checks the deepest part that already exists.
 */
export async function assertInsideRoot(target: ResolvedTarget, relative: string): Promise<void> {
  if (target.type !== 'local') return;
  const root = await realpath(text(target.settings, 'root')).catch(() => {
    throw new StorageError('STORAGE_NOT_FOUND', text(target.settings, 'root'));
  });
  let candidate = path.join(root, target.basePath, relative);
  for (;;) {
    const real = await realpath(candidate).catch(() => null);
    if (real) {
      if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
        throw new HttpError(403, 'STORAGE_PATH_INVALID', relative);
      }
      return;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) throw new HttpError(403, 'STORAGE_PATH_INVALID', relative);
    candidate = parent;
  }
}

/** A path from the browser, checked: relative and never above the base folder. */
export function relativePath(input: string | undefined): string {
  try {
    return normalizeRelativePath(input ?? '');
  } catch (error) {
    if (error instanceof StoragePathError) throw new HttpError(400, 'STORAGE_PATH_INVALID', input);
    throw error;
  }
}

export function connect(ctx: AppContext, target: ResolvedTarget): RcloneConnection {
  return new RcloneConnection(ctx.rclone, rcloneRemote(target));
}

/** Stores a new location or updates one; returns the saved row. */
export function saveTarget(
  ctx: AppContext,
  userId: string,
  request: SaveTargetRequest,
  existing?: StorageTargetRecord,
): StorageTargetRecord {
  const input = saveTargetRequestSchema.parse(request);
  const previous = existing ? resolveRecord(ctx, existing).secrets : {};
  const resolved = validateTarget(ctx, input, previous);
  const id = existing?.id ?? randomUUID();
  const secretKeys = Object.keys(resolved.secrets).filter((k) =>
    secretFields(resolved.type).includes(k),
  );
  const values = {
    name: input.name,
    type: resolved.type,
    basePath: resolved.basePath,
    asTarget: input.usage.asTarget,
    asSource: input.usage.asSource,
    conflictPolicy: input.conflictPolicy,
    subfolderPattern: input.subfolderPattern,
    isDefault: input.isDefault,
    settings: { ...resolved.settings, __secretKeys: secretKeys.join(',') },
    secrets:
      secretKeys.length > 0
        ? ctx.secrets.encrypt(JSON.stringify(resolved.secrets), secretContext(userId, id))
        : null,
    updatedAt: new Date(),
  };
  ctx.db.transaction((tx) => {
    if (input.isDefault) {
      tx.update(storageTargets)
        .set({ isDefault: false })
        .where(eq(storageTargets.userId, userId))
        .run();
    }
    if (existing) {
      tx.update(storageTargets).set(values).where(eq(storageTargets.id, id)).run();
    } else {
      tx.insert(storageTargets)
        .values({ id, userId, ...values })
        .run();
    }
  });
  return getOwnTarget(ctx, userId, id);
}
