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
