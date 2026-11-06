import { z } from 'zod';
import { WHISPER_MODELS } from '@conbert/core';

const modelIds = WHISPER_MODELS.map((m) => m.id) as [string, ...string[]];
export const whisperModelIdSchema = z.enum(modelIds);

export const whisperModelStatusSchema = z.object({
  id: whisperModelIdSchema,
  bytes: z.number(),
  installed: z.boolean(),
  /** Bytes received while a download runs, else null. */
  downloading: z.number().nullable(),
});

// --- GET /api/whisper ---
export const whisperStatusSchema = z.object({
  /** Is whisper.cpp itself installed on the server? */
  available: z.boolean(),
  defaultModel: whisperModelIdSchema,
  models: z.array(whisperModelStatusSchema),
});
export type WhisperStatus = z.infer<typeof whisperStatusSchema>;

// --- PUT /api/whisper/default ---
export const setWhisperModelSchema = z.object({ model: whisperModelIdSchema });

// --- GET /api/image-ai (background removal, upscaling) ---
export const imageAiStatusSchema = z.object({
  available: z.boolean(),
  models: z.array(
    z.object({
      id: z.string(),
      bytes: z.number(),
      installed: z.boolean(),
      downloading: z.number().nullable(),
    }),
  ),
});
export type ImageAiStatus = z.infer<typeof imageAiStatusSchema>;
