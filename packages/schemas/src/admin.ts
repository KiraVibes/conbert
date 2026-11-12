import { z } from 'zod';
import { jobStatusSchema } from './jobs';

// --- GET /api/me/usage ---
export const usageSchema = z.object({
  usedBytes: z.number(),
  /** null = no limit. */
  quotaBytes: z.number().nullable(),
});
export type Usage = z.infer<typeof usageSchema>;

// --- PUT /api/admin/quota-default, PUT /api/admin/users/:id/quota ---
export const quotaDefaultRequestSchema = z.object({
  /** null = no limit for everyone. */
  bytes: z.number().int().positive().nullable(),
});
export const userQuotaRequestSchema = z.object({
  quota: z.union([z.literal('default'), z.literal('unlimited'), z.number().int().positive()]),
});

// --- GET /api/admin/overview ---
export const adminOverviewSchema = z.object({
  system: z.object({
    version: z.string(),
    node: z.string(),
    platform: z.string(),
    cpus: z.number(),
    /** Load average over 1, 5 and 15 minutes. */
    load: z.array(z.number()),
    memTotal: z.number(),
    memFree: z.number(),
    processMemory: z.number(),
    uptimeSeconds: z.number(),
  }),
  disk: z.object({
    path: z.string(),
    total: z.number(),
    free: z.number(),
    uploads: z.number(),
    tmp: z.number(),
    models: z.number(),
  }),
  quotaDefault: z.number().nullable(),
  /** Hours downloads stay in the server archive. */
  archiveKeepHours: z.number(),
  users: z.array(
    z.object({
      id: z.string(),
      username: z.string(),
      role: z.enum(['admin', 'user']),
      usedBytes: z.number(),
      quotaBytes: z.number().nullable(),
      quotaSetting: z.enum(['default', 'unlimited', 'custom']),
    }),
  ),
  jobs: z.object({
    queueHealthy: z.boolean(),
    queued: z.number(),
    running: z.number(),
    done24h: z.number(),
    failed24h: z.number(),
    active: z.array(
      z.object({
        id: z.string(),
        user: z.string(),
        inputExt: z.string(),
        outputExt: z.string(),
        status: jobStatusSchema,
        progress: z.number(),
        stage: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
    recentErrors: z.array(
      z.object({
        id: z.string(),
        user: z.string(),
        inputExt: z.string(),
        outputExt: z.string(),
        errorKey: z.string(),
        createdAt: z.string(),
      }),
    ),
  }),
  downloads: z.object({ queued: z.number(), running: z.number() }),
  // Own list (importing it from ./index would be a circular import).
  engines: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['uninitialized', 'loading', 'ready', 'partial', 'error']),
    }),
  ),
  models: z.array(
    z.object({
      kind: z.enum(['whisper', 'image']),
      id: z.string(),
      bytes: z.number(),
      installed: z.boolean(),
    }),
  ),
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

// --- Server log (GET/PUT /api/admin/logs/settings, GET /api/admin/logs) ---

/** How much goes into the log: only errors, the important events, or everything. */
export const LOG_DETAILS = ['errors', 'normal', 'detailed'] as const;
export const logDetailSchema = z.enum(LOG_DETAILS);
export type LogDetail = z.infer<typeof logDetailSchema>;

/** Which part of Conbert an entry comes from. */
export const LOG_AREAS = [
  'system',
  'http',
  'process',
  'auth',
  'job',
  'download',
  'feed',
  'booru',
  'workflow',
  'storage',
  'swipe',
  'ldap',
] as const;
export const logAreaSchema = z.enum(LOG_AREAS);
export type LogArea = z.infer<typeof logAreaSchema>;

export const LOG_LIMIT_MB = { min: 1, max: 500, default: 20 } as const;
export const LOG_LIMIT_LINES = { min: 1000, max: 1_000_000, default: 50_000 } as const;

export const logLimitSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('size'),
    mb: z.number().int().min(LOG_LIMIT_MB.min).max(LOG_LIMIT_MB.max),
  }),
  z.object({
    kind: z.literal('lines'),
    count: z.number().int().min(LOG_LIMIT_LINES.min).max(LOG_LIMIT_LINES.max),
  }),
]);
export type LogLimit = z.infer<typeof logLimitSchema>;

export const logSettingsSchema = z.object({
  detail: logDetailSchema,
  limit: logLimitSchema,
});
export type LogSettings = z.infer<typeof logSettingsSchema>;

export const DEFAULT_LOG_SETTINGS: LogSettings = {
  detail: 'normal',
  limit: { kind: 'size', mb: LOG_LIMIT_MB.default },
};

export const logSettingsResponseSchema = logSettingsSchema.extend({
  /** What the log holds right now. */
  usedBytes: z.number().int(),
  usedLines: z.number().int(),
  /** false when the server writes no log file (only in tests). */
  enabled: z.boolean(),
});
export type LogSettingsResponse = z.infer<typeof logSettingsResponseSchema>;

export const logLevelSchema = z.enum(['error', 'warn', 'info', 'debug']);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const logQuerySchema = z.object({
  /** Shows this level and the more important ones. */
  level: logLevelSchema.default('debug'),
  area: logAreaSchema.optional(),
  q: z.string().trim().max(200).optional(),
  /** Older entries than this cursor (from the last page). */
  before: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const logEntrySchema = z.object({
  /** Where the entry sits – also the cursor for older ones. */
  id: z.string(),
  time: z.string(),
  level: logLevelSchema,
  area: z.string().nullable(),
  msg: z.string(),
  /** Everything else that came with it (user, duration, program output …). */
  details: z.record(z.string(), z.unknown()),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const logPageSchema = z.object({
  entries: z.array(logEntrySchema),
  /** null = nothing older. */
  next: z.string().nullable(),
});
export type LogPage = z.infer<typeof logPageSchema>;
