import { z } from 'zod';

// --- GET /api/blender (admins) ---
export const blenderStatusSchema = z.object({
  /** Official Blender builds exist for Linux x64 only. */
  supported: z.boolean(),
  version: z.string(),
  installed: z.boolean(),
  /** What runs right now. */
  phase: z.enum(['idle', 'downloading', 'extracting']),
  /** Bytes received while downloading, else null. */
  received: z.number().nullable(),
  /** Size of the download. */
  downloadBytes: z.number(),
  /** Roughly the space Blender needs once unpacked. */
  installedBytes: z.number(),
  /** i18n key of the last failed attempt, if any. */
  errorKey: z.string().nullable(),
});
export type BlenderStatus = z.infer<typeof blenderStatusSchema>;
