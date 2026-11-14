import { z } from 'zod';
import { CATEGORIES, type Category, type EngineDescriptor } from '@conbert/core';

// --- Shared building blocks ---

export const runtimeSchema = z.enum(['browser', 'server']);
// CATEGORIES is a plain array; z.enum needs a non-empty tuple type.
export const categorySchema = z.enum(CATEGORIES as unknown as [Category, ...Category[]]);
export const engineStatusSchema = z.enum(['uninitialized', 'loading', 'ready', 'partial', 'error']);

export const formatSupportSchema = z.object({
  ext: z.string().regex(/^[a-z0-9]+$/, 'lowercase extension without dot'),
  mime: z.string().optional(),
  canRead: z.boolean(),
  canWrite: z.boolean(),
});

export const engineOptionSchema = z.object({
  key: z.string().min(1),
  labelKey: z.string().min(1),
  helpKey: z.string().min(1),
  effectKey: z.string().min(1).optional(),
  advanced: z.boolean(),
  type: z.enum(['number', 'select', 'boolean', 'string', 'file']),
  accept: z.array(z.string()).optional(),
  default: z.unknown(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  choices: z
    .array(
      z.object({
        value: z.string(),
        labelKey: z.string().min(1),
        helpKey: z.string().min(1).optional(),
      }),
    )
    .optional(),
  appliesTo: z.array(z.string()).optional(),
});

export const engineDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  descriptionKey: z.string().min(1),
  category: categorySchema,
  runtime: runtimeSchema,
  formats: z.array(formatSupportSchema),
  options: z.array(engineOptionSchema),
  supportsCompression: z.boolean(),
  supportsTrim: z.boolean().optional(),
  priority: z.number(),
  status: engineStatusSchema,
});

// --- Errors ---

/**
 * Every API error carries an i18n key so the UI can show the three-part
 * error (what happened / possible cause / what you can do). Technical
 * details are optional and only shown behind "Show details".
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    messageKey: z.string().min(1),
    details: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// --- GET /api/health ---

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  name: z.literal('conbert'),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  /** Job queue for server conversions (Valkey/Redis). */
  queue: z.enum(['ok', 'unavailable']).optional(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// --- GET /api/engines ---

export const hardwareSchema = z.object({
  /** GPU family that passed a real test encode on the server, or null. */
  gpu: z.enum(['nvenc', 'qsv', 'vaapi']).nullable(),
  /** Hardware encoders ffmpeg was built with (may still be unusable). */
  compiled: z.array(z.enum(['nvenc', 'qsv', 'vaapi'])),
});
export type Hardware = z.infer<typeof hardwareSchema>;

export const enginesResponseSchema = z.object({
  engines: z.array(engineDescriptorSchema),
  hardware: hardwareSchema.optional(),
});
export type EnginesResponse = z.infer<typeof enginesResponseSchema>;

// Compile-time guard: schema and core type must stay assignable both ways.
type InferredDescriptor = z.infer<typeof engineDescriptorSchema>;
export function _assertDescriptorInSync(a: InferredDescriptor, b: EngineDescriptor): void {
  const toCore: EngineDescriptor = a;
  const toSchema: InferredDescriptor = b;
  void toCore;
  void toSchema;
}

export * from './permissions';
export * from './ldap';
export * from './auth';
export * from './jobs';
export * from './storage';
export * from './downloader';
export * from './booru';
export * from './workflows';
export * from './keys';
export * from './media';
export * from './whisper';
export * from './blender';
export * from './tokens';
export * from './admin';
export * from './server-archive';
export * from './pdf';
