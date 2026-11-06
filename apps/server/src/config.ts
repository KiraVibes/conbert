import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));

/** apps/web/dist, seen from apps/server/src (dev) or apps/server/dist (build). */
const defaultWebDir = path.resolve(here, '../../web/dist');
/** apps/server/drizzle, seen from src (dev) or dist (build). */
const defaultMigrationsDir = path.resolve(here, '../drizzle');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CONBERT_HOST: z.string().default('0.0.0.0'),
  CONBERT_PORT: z.coerce.number().int().min(1).max(65535).default(3313),
  CONBERT_DATA_DIR: z.string().default(path.resolve(process.cwd(), 'data')),
  CONBERT_WEB_DIR: z.string().default(defaultWebDir),
  CONBERT_MIGRATIONS_DIR: z.string().default(defaultMigrationsDir),
  CONBERT_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  CONBERT_REDIS_URL: z.string().default('redis://localhost:6379'),
  /** Several Conbert instances can share one Valkey with different names. */
  CONBERT_QUEUE_NAME: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .default('conbert-convert'),
  CONBERT_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(1_000_000).default(2048),
  CONBERT_CLEANUP_MINUTES: z.coerce.number().int().min(1).max(100_000).default(60),
  CONBERT_SESSION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  CONBERT_JOB_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
  /** Fixed setup code instead of a random one printed to the log. */
  CONBERT_SETUP_CODE: optionalString,
  /** Header with the user name set by a trusted reverse proxy, e.g. "Remote-User". */
  CONBERT_AUTH_PROXY_HEADER: optionalString,
  /** Comma-separated IPs/CIDRs of proxies allowed to set that header. */
  CONBERT_TRUSTED_PROXIES: optionalString,
  /**
   * Key for stored credentials (passwords of storage locations …). Without it,
   * Conbert creates a random key once in the data folder.
   */
  CONBERT_SECRET: optionalString,
  /** Comma-separated folders that "local folder" locations may point to. */
  CONBERT_STORAGE_ROOTS: z.string().default('/storage'),
  CONBERT_RCLONE_PATH: z.string().default('rclone'),
  /** Folder with yt-dlp, gallery-dl and pip (the Docker image sets it); empty = PATH. */
  CONBERT_DOWNLOADER_BIN: optionalString,
  /** Folder URL to download Whisper models from (default: Hugging Face). */
  CONBERT_WHISPER_MODEL_URL: optionalString,
  /** Own booru instances may be in the home network (off: only public addresses). */
  CONBERT_BOORU_ALLOW_PRIVATE: z
    .enum(['0', '1', 'true', 'false', ''])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export interface ProxyAuthConfig {
  header: string;
  trustedProxies: string[];
}

export interface Config {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  dataDir: string;
  webDir: string;
  migrationsDir: string;
  logLevel: z.infer<typeof envSchema>['CONBERT_LOG_LEVEL'];
  redisUrl: string;
  queueName: string;
  maxUploadBytes: number;
  cleanupAfterMs: number;
  sessionDays: number;
  jobConcurrency: number;
  setupCode: string | undefined;
  /** Only set when both the header and the trusted proxies are configured. */
  proxyAuth: ProxyAuthConfig | undefined;
  /** CONBERT_SECRET as given (may be undefined – see loadSecretKey). */
  secret: string | undefined;
  /** Absolute folders that local storage locations must stay inside. */
  storageRoots: string[];
  rclonePath: string;
  downloaderBin: string | undefined;
  whisperModelUrl: string | undefined;
  /** Own booru instances may use addresses in the home network. */
  booruAllowPrivate: boolean;
}

export class ConfigError extends Error {}

/** Reads and validates the configuration from environment variables. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid configuration:\n${issues}`);
  }
  const e = parsed.data;
  const trustedProxies = (e.CONBERT_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (e.CONBERT_SECRET !== undefined && e.CONBERT_SECRET.length < 16) {
    throw new ConfigError(
      'CONBERT_SECRET is too short. Use at least 16 random characters, e.g. from: openssl rand -base64 32',
    );
  }
  const storageRoots = e.CONBERT_STORAGE_ROOTS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => path.resolve(s));
  if (e.CONBERT_AUTH_PROXY_HEADER && trustedProxies.length === 0) {
    throw new ConfigError(
      'CONBERT_AUTH_PROXY_HEADER is set, but CONBERT_TRUSTED_PROXIES is empty. ' +
        'List the IP addresses of your reverse proxy, otherwise anyone could fake the header.',
    );
  }
  return {
    env: e.NODE_ENV,
    host: e.CONBERT_HOST,
    port: e.CONBERT_PORT,
    dataDir: path.resolve(e.CONBERT_DATA_DIR),
    webDir: path.resolve(e.CONBERT_WEB_DIR),
    migrationsDir: path.resolve(e.CONBERT_MIGRATIONS_DIR),
    logLevel: e.CONBERT_LOG_LEVEL,
    redisUrl: e.CONBERT_REDIS_URL,
    queueName: e.CONBERT_QUEUE_NAME,
    maxUploadBytes: e.CONBERT_MAX_UPLOAD_MB * 1024 * 1024,
    cleanupAfterMs: e.CONBERT_CLEANUP_MINUTES * 60 * 1000,
    sessionDays: e.CONBERT_SESSION_DAYS,
    jobConcurrency: e.CONBERT_JOB_CONCURRENCY,
    setupCode: e.CONBERT_SETUP_CODE,
    proxyAuth: e.CONBERT_AUTH_PROXY_HEADER
      ? { header: e.CONBERT_AUTH_PROXY_HEADER.toLowerCase(), trustedProxies }
      : undefined,
    secret: e.CONBERT_SECRET,
    storageRoots,
    rclonePath: e.CONBERT_RCLONE_PATH,
    downloaderBin: e.CONBERT_DOWNLOADER_BIN,
    whisperModelUrl: e.CONBERT_WHISPER_MODEL_URL,
    booruAllowPrivate: e.CONBERT_BOORU_ALLOW_PRIVATE,
  };
}

/** Folders below the data directory. */
export function dataPaths(config: Config) {
  return {
    database: path.join(config.dataDir, 'conbert.db'),
    uploads: path.join(config.dataDir, 'uploads'),
    tmp: path.join(config.dataDir, 'tmp'),
    /** Generated key for credentials when CONBERT_SECRET is not set. */
    secretKey: path.join(config.dataDir, 'secret.key'),
    /** rclone's empty config file and cache (no passwords are ever written there). */
    rclone: path.join(config.dataDir, 'rclone'),
    /** Speech models, downloaded on first use. */
    whisperModels: path.join(config.dataDir, 'models', 'whisper'),
    /** Models for background removal and upscaling. */
    imageModels: path.join(config.dataDir, 'models', 'image'),
    /** Blender, installed by the admin on demand. */
    blender: path.join(config.dataDir, 'tools', 'blender'),
  };
}
