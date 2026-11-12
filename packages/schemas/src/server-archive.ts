import { z } from 'zod';

/**
 * Server archive: downloads kept on the server without a storage location,
 * until the admin's keeping time is over.
 */

/** Keeping times the admin can pick, in hours (1 hour … 90 days). */
export const ARCHIVE_KEEP_CHOICES = [1, 24, 72, 168, 336, 720, 2160] as const;
export const DEFAULT_ARCHIVE_KEEP_HOURS = 168;
export const MAX_ARCHIVE_KEEP_HOURS = 2160;
/** A ZIP of archived files has no ZIP64: everything together stays below 4 GB. */
export const ARCHIVE_ZIP_MAX_BYTES = 4_000_000_000;

// --- GET /api/archive/files ---
export const archivedFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  ext: z.string(),
  size: z.number(),
  createdAt: z.string(),
  /** Deleted automatically at this time. */
  expiresAt: z.string(),
  /** Where it came from ("Instagram · nasa"). */
  source: z.string(),
  /** A preview picture exists: GET /api/archive/files/:id/thumb. */
  thumbnail: z.boolean(),
});
export type ArchivedFile = z.infer<typeof archivedFileSchema>;

export const serverArchiveSchema = z.object({
  files: z.array(archivedFileSchema),
  /** How long new files stay (set by the admin). */
  keepHours: z.number(),
});
export type ServerArchive = z.infer<typeof serverArchiveSchema>;

// --- GET /api/archive/zip?ids=a,b ---
export const archiveZipQuerySchema = z.object({
  /** Comma-separated file ids; empty = everything in the archive. */
  ids: z.string().max(100_000).optional(),
});

// --- PUT /api/admin/archive-keep ---
export const archiveKeepRequestSchema = z.object({
  hours: z.number().int().min(1).max(MAX_ARCHIVE_KEEP_HOURS),
});
