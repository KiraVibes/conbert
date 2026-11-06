/**
 * External storage locations (NAS, SFTP server, Nextcloud, S3 …) where
 * results can be saved and files can be opened from.
 */

export type StorageType =
  'smb' | 'sftp' | 'ftp' | 'webdav' | 's3' | 'gdrive' | 'onedrive' | 'dropbox' | 'local';

export interface StorageTarget {
  id: string;
  /** Chosen by the user: „NAS Wohnzimmer – Fotos“. */
  name: string;
  type: StorageType;
  basePath: string;
  usage: { asTarget: boolean; asSource: boolean };
  conflictPolicy: 'rename' | 'overwrite' | 'skip';
  /** e.g. '{date}/{category}' – folders created below basePath when saving. */
  subfolderPattern?: string;
}

/** Every planned type (the API accepts them and explains which aren't ready yet). */
export const ALL_STORAGE_TYPES = [
  'smb',
  'sftp',
  'ftp',
  'webdav',
  's3',
  'gdrive',
  'onedrive',
  'dropbox',
  'local',
] as const satisfies readonly StorageType[];

/** Types that can be set up today (cloud services with sign-in follow later). */
export const STORAGE_TYPES = ['smb', 'sftp', 'ftp', 'webdav', 's3', 'local'] as const;
export type SupportedStorageType = (typeof STORAGE_TYPES)[number];

export const CONFLICT_POLICIES = ['rename', 'overwrite', 'skip'] as const;

/** One input field of the setup wizard. */
export interface StorageField {
  key: string;
  type: 'text' | 'password' | 'number' | 'select' | 'textarea' | 'boolean' | 'root';
  /** Secrets are stored encrypted and never sent back to the browser. */
  secret: boolean;
  required: boolean;
  /** Only shown in expert mode. */
  advanced: boolean;
  labelKey: string;
  helpKey: string;
  /** Example value shown in the empty field. */
  placeholderKey?: string;
  default?: string | number | boolean;
  choices?: { value: string; labelKey: string }[];
}

const field = (
  type: SupportedStorageType,
  key: string,
  rest: Partial<StorageField> & Pick<StorageField, 'type'>,
): StorageField => ({
  key,
  secret: false,
  required: false,
  advanced: false,
  labelKey: `storage.fields.${key}.label`,
  helpKey: `storage.fields.${type}.${key}`,
  ...rest,
});

const login = (type: SupportedStorageType, required: boolean): StorageField[] => [
  field(type, 'user', { type: 'text', required, placeholderKey: 'storage.placeholders.user' }),
  field(type, 'password', { type: 'password', secret: true }),
];

export const STORAGE_FIELDS: Record<SupportedStorageType, StorageField[]> = {
  smb: [
    field('smb', 'address', {
      type: 'text',
      required: true,
      placeholderKey: 'storage.placeholders.smbAddress',
    }),
    ...login('smb', false),
    field('smb', 'domain', {
      type: 'text',
      advanced: true,
      placeholderKey: 'storage.placeholders.domain',
    }),
    field('smb', 'port', { type: 'number', advanced: true, default: 445 }),
  ],
  sftp: [
    field('sftp', 'host', {
      type: 'text',
      required: true,
      placeholderKey: 'storage.placeholders.host',
    }),
    ...login('sftp', true),
    field('sftp', 'privateKey', {
      type: 'textarea',
      secret: true,
      advanced: true,
      placeholderKey: 'storage.placeholders.privateKey',
    }),
    field('sftp', 'port', { type: 'number', advanced: true, default: 22 }),
  ],
  ftp: [
    field('ftp', 'host', {
      type: 'text',
      required: true,
      placeholderKey: 'storage.placeholders.host',
    }),
    ...login('ftp', true),
    field('ftp', 'security', {
      type: 'select',
      default: 'explicit',
      choices: ['explicit', 'implicit', 'none'].map((value) => ({
        value,
        labelKey: `storage.fields.security.${value}`,
      })),
    }),
    field('ftp', 'skipCertificateCheck', { type: 'boolean', advanced: true, default: false }),
    field('ftp', 'port', { type: 'number', advanced: true }),
  ],
  webdav: [
    field('webdav', 'url', {
      type: 'text',
      required: true,
      placeholderKey: 'storage.placeholders.webdavUrl',
    }),
    field('webdav', 'vendor', {
      type: 'select',
      default: 'nextcloud',
      choices: ['nextcloud', 'owncloud', 'other'].map((value) => ({
        value,
        labelKey: `storage.fields.vendor.${value}`,
      })),
    }),
    ...login('webdav', true),
  ],
  s3: [
    field('s3', 'provider', {
      type: 'select',
      default: 'Other',
      choices: ['AWS', 'Minio', 'Wasabi', 'Cloudflare', 'Other'].map((value) => ({
        value,
        labelKey: `storage.fields.provider.${value}`,
      })),
    }),
    field('s3', 'endpoint', { type: 'text', placeholderKey: 'storage.placeholders.s3Endpoint' }),
    field('s3', 'bucket', {
      type: 'text',
      required: true,
      placeholderKey: 'storage.placeholders.bucket',
    }),
    field('s3', 'accessKeyId', { type: 'text', required: true }),
    field('s3', 'secretAccessKey', { type: 'password', secret: true, required: true }),
    field('s3', 'region', {
      type: 'text',
      advanced: true,
      placeholderKey: 'storage.placeholders.region',
    }),
  ],
  local: [field('local', 'root', { type: 'root', required: true })],
};

/** Fields whose value is a secret (stored encrypted, never returned). */
export function secretFields(type: SupportedStorageType): string[] {
  return STORAGE_FIELDS[type].filter((f) => f.secret).map((f) => f.key);
}

/** All i18n keys the storage setup needs – checked by a test. */
export function storageI18nKeys(): string[] {
  const keys = new Set<string>();
  for (const type of STORAGE_TYPES) {
    keys.add(`storage.types.${type}.name`);
    keys.add(`storage.types.${type}.summary`);
    for (const f of STORAGE_FIELDS[type]) {
      keys.add(f.labelKey);
      keys.add(f.helpKey);
      if (f.placeholderKey) keys.add(f.placeholderKey);
      for (const c of f.choices ?? []) keys.add(c.labelKey);
    }
  }
  for (const policy of CONFLICT_POLICIES) keys.add(`storage.conflict.${policy}`);
  return [...keys];
}

export class StoragePathError extends Error {
  constructor(path: string) {
    super(`invalid storage path: ${path}`);
    this.name = 'StoragePathError';
  }
}

/**
 * A path inside a storage location, chosen in the browser: always relative,
 * never above the location's base folder. Returns '' for the base folder.
 */
export function normalizeRelativePath(input: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are never valid here
  if (/[\u0000-\u001f\u007f]/.test(input)) throw new StoragePathError(input);
  const parts: string[] = [];
  for (const part of input.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw new StoragePathError(input);
    parts.push(part);
  }
  return parts.join('/');
}

/**
 * The base folder of a location, as typed by its owner. It may be absolute
 * (SFTP: "/volume1/photos"); ".." is resolved, never above the start.
 */
export function normalizeBasePath(input: string): string {
  const absolute = /^[\\/]/.test(input.trim());
  const relative = normalizeRelativePath(input.trim());
  return absolute ? `/${relative}` : relative;
}

/** Joins path parts with "/", skipping empty ones. */
export function joinStoragePath(...parts: string[]): string {
  const joined = parts.filter((p) => p !== '').join('/');
  return joined.replace(/\/{2,}/g, '/');
}

export interface SmbAddress {
  host: string;
  share: string;
  /** Folder inside the share ('' = its top). */
  path: string;
}

/**
 * Understands the ways people copy a network folder:
 * `\\192.168.1.10\Fotos\2024`, `smb://nas.local/Fotos`, `nas.local/Fotos`.
 */
export function parseSmbAddress(input: string): SmbAddress | null {
  const cleaned = input
    .trim()
    .replace(/^smb:\/\//i, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const [host, share, ...rest] = cleaned.split('/').filter(Boolean);
  if (!host || !share || !/^[\w.-]+$/.test(host)) return null;
  try {
    return { host, share, path: normalizeRelativePath(rest.join('/')) };
  } catch {
    return null;
  }
}

/** Characters that are not allowed in file or folder names on common systems. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what must go
const UNSAFE_NAME = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/** A single folder or file name that works on Windows shares, NAS and S3 alike. */
export function safeName(name: string): string {
  const cleaned = name.replace(UNSAFE_NAME, '_').replace(/^[.\s]+|[.\s]+$/g, '');
  return cleaned.slice(0, 200) || '_';
}

export interface SubfolderValues {
  date: Date;
  /** Category of the saved file (image, video …). */
  category?: string;
  ext?: string;
  /** Social-media downloads: platform and account name. */
  platform?: string;
  username?: string;
  /** Downloads: the channel, profile, thread or playlist the file comes from. */
  source?: string;
  /** Downloads: the platform's top folder ("Instagram", "4chan/g"), see platformFolder(). */
  platformFolder?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Fills a folder pattern like '{date}/{category}'. Unknown placeholders and
 * missing values become "_"; every part is made safe on its own.
 */
export function expandSubfolderPattern(pattern: string, values: SubfolderValues): string {
  const d = values.date;
  const map: Record<string, string | undefined> = {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    year: String(d.getFullYear()),
    month: pad(d.getMonth() + 1),
    day: pad(d.getDate()),
    category: values.category,
    ext: values.ext,
    platform: values.platform,
    username: values.username,
    source: values.source,
  };
  return pattern
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.replace(/\{(\w+)\}/g, (_m, key: string) => map[key] ?? '_'))
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .map(safeName)
    .join('/');
}

/**
 * The folder for a download: its own folder pattern, plus a folder named
 * after the channel, profile or thread – unless the pattern places it already.
 */
export function downloadFolder(pattern: string, values: SubfolderValues): string {
  const base = expandSubfolderPattern(pattern, values);
  // A pattern with {platform} places the platform itself.
  const top =
    values.platformFolder && !pattern.includes('{platform}')
      ? values.platformFolder
          .split('/')
          .map((p) => p.trim())
          .filter((p) => p !== '' && p !== '.' && p !== '..')
          .map(safeName)
          .join('/')
      : '';
  const own =
    values.source?.trim() && !pattern.includes('{source}')
      ? safeName(values.source.trim().slice(0, 80))
      : '';
  return [base, top, own].filter(Boolean).join('/');
}

/** "Bild.png" → "Bild (2).png" for the n-th copy. */
export function numberedName(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name} (${n})`;
  return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
}
