import { z } from 'zod';
import { EDIT_ACTIONS, MAX_WORKFLOW_STEPS } from '@conbert/core';

const ext = z.string().regex(/^[a-z0-9]{1,10}$/);
const options = z.record(z.string(), z.unknown());

export const workflowStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('convert'), outputExt: ext, options: options.default({}) }),
  z.object({
    kind: z.literal('compress'),
    preset: z.enum(['max', 'balanced', 'small']),
    options: options.optional(),
  }),
  z.object({
    kind: z.literal('filter'),
    rule: z.object({
      category: z.array(z.string().max(20)).max(12).optional(),
      ext: z.array(ext).max(40).optional(),
      minWidth: z.number().int().min(1).max(100_000).optional(),
      maxSizeMb: z.number().min(0.01).max(1_000_000).optional(),
    }),
  }),
  z.object({ kind: z.literal('edit'), action: z.enum(EDIT_ACTIONS), params: options.default({}) }),
  z.object({
    kind: z.literal('save'),
    targetIds: z.array(z.string().uuid()).max(10),
    subfolderPattern: z.string().max(200).optional(),
  }),
  z.object({ kind: z.literal('ocr'), options: options.default({}) }),
  z.object({ kind: z.literal('workshop'), trick: z.string().max(40), params: options.default({}) }),
  z.object({ kind: z.literal('notify'), channelIds: z.array(z.string().uuid()).max(10) }),
]);
export type WorkflowStepInput = z.input<typeof workflowStepSchema>;

export const workflowStepsSchema = z.array(workflowStepSchema).min(1).max(MAX_WORKFLOW_STEPS);

export const workflowRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  steps: workflowStepsSchema,
  keepOriginal: z.boolean().default(false),
});
export type WorkflowRequest = z.input<typeof workflowRequestSchema>;

export const workflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(workflowStepSchema),
  keepOriginal: z.boolean(),
  runtime: z.literal('server'),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
});
export type WorkflowDto = z.infer<typeof workflowSchema>;
export const workflowsResponseSchema = z.object({ workflows: z.array(workflowSchema) });
export const workflowResponseSchema = z.object({ workflow: workflowSchema });

/** Export/import file: the workflow without IDs of this server. */
export const workflowExportSchema = z.object({
  conbertWorkflow: z.literal(1),
  name: z.string().trim().min(1).max(80),
  steps: workflowStepsSchema,
  keepOriginal: z.boolean().default(false),
});

/** "Danach automatisch …": a saved workflow or a quick single action. */
export const afterDownloadSchema = z
  .union([z.object({ workflowId: z.string().uuid() }), z.object({ steps: workflowStepsSchema })])
  .nullable()
  .default(null);
export type AfterDownload = z.infer<typeof afterDownloadSchema>;

export const runWorkflowRequestSchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(500),
  /** Results come back into the conversion list (the browser loads them). */
  toList: z.boolean().default(true),
});

export const testWorkflowRequestSchema = z.object({ fileId: z.string().uuid() });

export const WORKFLOW_RUN_STATUSES = ['queued', 'running', 'done', 'error', 'cancelled'] as const;

export const workflowRunFileSchema = z.object({
  sourceName: z.string(),
  status: z.enum(['pending', 'done', 'skipped', 'error']),
  /** The result, still on the server (for the list or the test preview). */
  resultFileId: z.string().nullable(),
  resultName: z.string().nullable(),
  resultSize: z.number().nullable(),
  savedTo: z.array(z.string()),
  /** Test run: where it would have been saved. */
  wouldSaveTo: z.array(z.string()),
  /** Which step stopped the file (0-based) – for the error report. */
  failedStep: z.number().nullable(),
  error: z.object({ messageKey: z.string(), details: z.string().optional() }).nullable(),
});
export type WorkflowRunFile = z.infer<typeof workflowRunFileSchema>;

export const workflowRunSchema = z.object({
  id: z.string(),
  workflowId: z.string().nullable(),
  name: z.string(),
  status: z.enum(WORKFLOW_RUN_STATUSES),
  test: z.boolean(),
  toList: z.boolean(),
  total: z.number(),
  done: z.number(),
  failed: z.number(),
  skipped: z.number(),
  files: z.array(workflowRunFileSchema),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type WorkflowRunDto = z.infer<typeof workflowRunSchema>;
export const workflowRunResponseSchema = z.object({ run: workflowRunSchema });
export const workflowRunsResponseSchema = z.object({ runs: z.array(workflowRunSchema) });

// --- Notifications ---

export const NOTIFICATION_TYPES = [
  'browser',
  'ntfy',
  'gotify',
  'discord',
  'telegram',
  'email',
] as const;
export const NOTIFICATION_EVENTS = [
  'batch-done',
  'subscription-new',
  'error',
  'storage-low',
] as const;

export const channelRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(NOTIFICATION_TYPES),
  /** Non-secret settings (server address, topic, chat ID, recipient …). */
  settings: z.record(z.string(), z.string().max(500)).default({}),
  /** Tokens, webhook addresses, passwords – stored encrypted; empty = keep. */
  secrets: z.record(z.string(), z.string().max(1000)).default({}),
  events: z
    .array(z.enum(NOTIFICATION_EVENTS))
    .min(1)
    .default(['batch-done', 'subscription-new', 'error']),
});
export type ChannelRequest = z.input<typeof channelRequestSchema>;

export const channelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(NOTIFICATION_TYPES),
  settings: z.record(z.string(), z.string()),
  /** Which secret fields are stored (the values never come back). */
  storedSecrets: z.array(z.string()),
  events: z.array(z.enum(NOTIFICATION_EVENTS)),
  createdAt: z.string(),
});
export type ChannelDto = z.infer<typeof channelSchema>;
export const channelsResponseSchema = z.object({ channels: z.array(channelSchema) });

/** Pushed over the WebSocket for browser notifications. */
export const notificationSchema = z.object({
  event: z.enum(NOTIFICATION_EVENTS),
  titleKey: z.string(),
  bodyKey: z.string(),
  values: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type NotificationDto = z.infer<typeof notificationSchema>;
