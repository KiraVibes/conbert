import { z } from 'zod';
import { downloadSchema } from './downloader';
import { booruJobSchema } from './booru';
import { notificationSchema, workflowRunSchema } from './workflows';

export const jobStatusSchema = z.enum(['queued', 'running', 'done', 'error', 'cancelled']);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobStepSchema = z.object({
  engineId: z.string(),
  /** This step gets the job's options although it isn't the last (AI before converting). */
  withOptions: z.boolean().optional(),
  from: z.string(),
  to: z.string(),
});

export const jobSchema = z.object({
  id: z.string(),
  fileId: z.string().nullable(),
  inputExt: z.string(),
  outputExt: z.string(),
  steps: z.array(jobStepSchema),
  status: jobStatusSchema,
  /** 0–100 */
  progress: z.number().min(0).max(100),
  /** i18n stage id ('stages.<id>'), e.g. "converting". */
  stage: z.string().nullable(),
  error: z.object({ messageKey: z.string(), details: z.string().optional() }).nullable(),
  resultName: z.string().nullable(),
  resultSize: z.number().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type JobDto = z.infer<typeof jobSchema>;

// --- POST /api/jobs ---
export const createJobRequestSchema = z.object({
  fileId: z.string().uuid(),
  outputExt: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]{1,10}$/),
  options: z.record(z.string(), z.unknown()).default({}),
  /** Files for options of type 'file' (option key → uploaded file), e.g. subtitles to burn in. */
  attachments: z.record(z.string().max(64), z.string().uuid()).default({}),
  /** "ocr": make a scanned PDF searchable (ocrmypdf), output is always PDF. */
  mode: z.enum(['convert', 'compress', 'ocr']).default('convert'),
});
export type CreateJobRequest = z.input<typeof createJobRequestSchema>;

export const jobResponseSchema = z.object({ job: jobSchema });
export type JobResponse = z.infer<typeof jobResponseSchema>;

export const jobsResponseSchema = z.object({ jobs: z.array(jobSchema) });

// --- WS /api/ws ---
export const wsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello') }),
  z.object({ type: z.literal('job'), job: jobSchema }),
  z.object({ type: z.literal('download'), download: downloadSchema }),
  z.object({ type: z.literal('booru'), job: booruJobSchema }),
  z.object({ type: z.literal('workflow'), run: workflowRunSchema }),
  z.object({ type: z.literal('notification'), notification: notificationSchema }),
]);
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;
