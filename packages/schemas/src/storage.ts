import { z } from 'zod';
import { ALL_STORAGE_TYPES, CONFLICT_POLICIES } from '@conbert/core';

export const storageTypeSchema = z.enum(ALL_STORAGE_TYPES);
export const conflictPolicySchema = z.enum(CONFLICT_POLICIES);

/** Non-secret settings (host, user, URL …). Secrets travel separately. */
const settingsSchema = z.record(
  z.string().max(64),
  z.union([z.string().max(4096), z.number(), z.boolean()]),
);

const nameSchema = z.string().trim().min(1).max(100);
const patternSchema = z.string().trim().max(200);

/** A storage location as the browser sees it – never with passwords or keys. */
export const storageTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: storageTypeSchema,
  basePath: z.string(),
  usage: z.object({ asTarget: z.boolean(), asSource: z.boolean() }),
  conflictPolicy: conflictPolicySchema,
  subfolderPattern: z.string(),
  isDefault: z.boolean(),
  settings: settingsSchema,
  /** Which secret fields have a stored value (shown as „••••• gespeichert“). */
  storedSecrets: z.array(z.string()),
});
export type StorageTargetDto = z.infer<typeof storageTargetSchema>;

// --- POST /api/targets, PUT /api/targets/:id ---
export const saveTargetRequestSchema = z.object({
  name: nameSchema,
  type: storageTypeSchema,
  basePath: z.string().max(1024).default(''),
  usage: z
    .object({ asTarget: z.boolean(), asSource: z.boolean() })
    .refine((u) => u.asTarget || u.asSource, 'usage'),
  conflictPolicy: conflictPolicySchema.default('rename'),
  subfolderPattern: patternSchema.default(''),
  isDefault: z.boolean().default(false),
  settings: settingsSchema.default({}),
  /**
   * New secret values. A missing key keeps the stored value, null removes it.
   */
  secrets: z.record(z.string().max(64), z.string().max(16_384).nullable()).default({}),
});
export type SaveTargetRequest = z.input<typeof saveTargetRequestSchema>;

/**
 * PATCH /api/targets/:id – quick changes without the connection: name,
 * "save here" / "open from here", default. At least one use stays on.
 */
export const patchTargetRequestSchema = z
  .object({
    name: nameSchema.optional(),
    usage: z.object({ asTarget: z.boolean(), asSource: z.boolean() }).optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((b) => !b.usage || b.usage.asTarget || b.usage.asSource, 'usage');
export type PatchTargetRequest = z.input<typeof patchTargetRequestSchema>;

export const targetResponseSchema = z.object({ target: storageTargetSchema });
export const targetsResponseSchema = z.object({ targets: z.array(storageTargetSchema) });

// --- Folder listings ---
export const storageEntrySchema = z.object({
  name: z.string(),
  isDir: z.boolean(),
  size: z.number(),
  modTime: z.string().nullable(),
});
export type StorageEntry = z.infer<typeof storageEntrySchema>;

export const browseResponseSchema = z.object({
  /** Path relative to the location's base folder ('' = the base folder). */
  path: z.string(),
  entries: z.array(storageEntrySchema),
  /** True when the folder has more entries than were sent. */
  truncated: z.boolean(),
});
export type BrowseResponse = z.infer<typeof browseResponseSchema>;

/**
 * POST /api/targets/probe – test a location (saved or not yet saved) and
 * list one folder. With `id`, missing secrets come from the stored location.
 */
export const probeRequestSchema = z.object({
  id: z.string().uuid().optional(),
  target: saveTargetRequestSchema,
  path: z.string().max(1024).default(''),
});
export type ProbeRequest = z.input<typeof probeRequestSchema>;

/** Folders a local location may point to (mounted into the container). */
export const storageRootsResponseSchema = z.object({ roots: z.array(z.string()) });

// --- POST /api/targets/:id/mkdir ---
export const mkdirRequestSchema = z.object({
  path: z.string().max(1024).default(''),
  name: z.string().trim().min(1).max(200),
});

/** POST /api/targets/probe/mkdir – a new folder while the location is still being set up. */
export const probeMkdirRequestSchema = probeRequestSchema.extend({
  name: z.string().trim().min(1).max(200),
});
export type ProbeMkdirRequest = z.input<typeof probeMkdirRequestSchema>;

// --- POST /api/targets/:id/import ---
export const importRequestSchema = z.object({
  paths: z.array(z.string().min(1).max(1024)).min(1).max(50),
});
export const importedFileSchema = z.object({
  fileId: z.string(),
  name: z.string(),
  ext: z.string(),
  size: z.number(),
});
export const importResponseSchema = z.object({ files: z.array(importedFileSchema) });
export type ImportedFile = z.infer<typeof importedFileSchema>;

// --- POST /api/jobs/:id/export and /api/files/:id/export ---
export const exportRequestSchema = z.object({
  targetIds: z.array(z.string().uuid()).min(1).max(10),
  /** Folder below the base folder; replaces the location's folder pattern. */
  folder: z.string().max(1024).optional(),
  /** File name to save as (defaults to the result's name). */
  name: z.string().trim().min(1).max(255).optional(),
  /** Category of the file, for the {category} placeholder. */
  category: z.string().max(32).optional(),
});
export type ExportRequest = z.input<typeof exportRequestSchema>;

export const exportResultSchema = z.object({
  targetId: z.string(),
  status: z.enum(['saved', 'skipped', 'error']),
  /** Where it ended up, relative to the base folder. */
  path: z.string().nullable(),
  error: z.object({ messageKey: z.string(), details: z.string().optional() }).nullable(),
});
export type ExportResult = z.infer<typeof exportResultSchema>;
export const exportResponseSchema = z.object({ results: z.array(exportResultSchema) });
