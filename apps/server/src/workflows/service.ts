import { randomUUID } from 'node:crypto';
import { ownerMay } from '../auth/permissions';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { WorkflowStep } from '@conbert/core';
import {
  workflowExportSchema,
  type WorkflowDto,
  type WorkflowRunFile,
  type workflowRequestSchema,
} from '@conbert/schemas';
import type { AppContext } from '../context';
import { files, workflowRuns, workflows, type WorkflowRecord } from '../db/schema';
import { HttpError } from '../lib/http-error';
import { toWorkflowRunDto } from './executor';

type WorkflowInput = z.infer<typeof workflowRequestSchema>;

export function toWorkflowDto(row: WorkflowRecord): WorkflowDto {
  return {
    id: row.id,
    name: row.name,
    steps: row.steps as WorkflowDto['steps'],
    keepOriginal: row.keepOriginal,
    runtime: 'server',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

export function listWorkflows(ctx: AppContext, userId: string): WorkflowDto[] {
  return ctx.db
    .select()
    .from(workflows)
    .where(eq(workflows.userId, userId))
    .orderBy(workflows.name)
    .all()
    .map(toWorkflowDto);
}

export function ownWorkflow(ctx: AppContext, userId: string, id: string): WorkflowRecord {
  const row = ctx.db
    .select()
    .from(workflows)
    .where(and(eq(workflows.id, id), eq(workflows.userId, userId)))
    .get();
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  return row;
}

export function createWorkflow(ctx: AppContext, userId: string, input: WorkflowInput): WorkflowDto {
  const id = randomUUID();
  ctx.db
    .insert(workflows)
    .values({ id, userId, name: input.name, steps: input.steps, keepOriginal: input.keepOriginal })
    .run();
  return toWorkflowDto(ownWorkflow(ctx, userId, id));
}

export function updateWorkflow(
  ctx: AppContext,
  userId: string,
  id: string,
  input: WorkflowInput,
): WorkflowDto {
  ownWorkflow(ctx, userId, id);
  ctx.db
    .update(workflows)
    .set({
      name: input.name,
      steps: input.steps,
      keepOriginal: input.keepOriginal,
      updatedAt: new Date(),
    })
    .where(eq(workflows.id, id))
    .run();
  return toWorkflowDto(ownWorkflow(ctx, userId, id));
}

export function deleteWorkflow(ctx: AppContext, userId: string, id: string): void {
  ownWorkflow(ctx, userId, id);
  ctx.db.delete(workflows).where(eq(workflows.id, id)).run();
}

/** Export: storage locations and channels are this server's – they are left empty. */
export function exportWorkflow(row: WorkflowRecord) {
  const steps = (row.steps as WorkflowStep[]).map((step) =>
    step.kind === 'save'
      ? { ...step, targetIds: [] }
      : step.kind === 'notify'
        ? { ...step, channelIds: [] }
        : step,
  );
  return { conbertWorkflow: 1 as const, name: row.name, steps, keepOriginal: row.keepOriginal };
}

export function importWorkflow(ctx: AppContext, userId: string, body: unknown): WorkflowDto {
  const parsed = workflowExportSchema.safeParse(body);
  if (!parsed.success)
    throw new HttpError(422, 'WORKFLOW_IMPORT_INVALID', parsed.error.issues[0]?.message);
  const { name, steps, keepOriginal } = parsed.data;
  return createWorkflow(ctx, userId, {
    name,
    keepOriginal,
    // IDs from another server mean nothing here.
    steps: steps.map((step) =>
      step.kind === 'save'
        ? { ...step, targetIds: [] }
        : step.kind === 'notify'
          ? { ...step, channelIds: [] }
          : step,
    ),
  });
}

export interface RunInput {
  name: string;
  workflowId: string | null;
  steps: WorkflowStep[];
  keepOriginal: boolean;
  fileIds: string[];
  toList: boolean;
  test?: boolean;
  /** Delete the input files at the end (downloads that only went through the workflow). */
  dropInputs?: boolean;
}

/** Queues a run over the user's own files. */
export async function startRun(ctx: AppContext, userId: string, input: RunInput) {
  if (!ownerMay(ctx.db, userId, 'workflows'))
    throw new HttpError(403, 'FEATURE_FORBIDDEN', 'workflows');
  const owned = ctx.db
    .select({ id: files.id, name: files.originalName })
    .from(files)
    .where(and(eq(files.userId, userId), inArray(files.id, input.fileIds)))
    .all();
  if (owned.length !== new Set(input.fileIds).size) throw new HttpError(404, 'NOT_FOUND');
  if (!ctx.workflows.queue.isHealthy()) throw new HttpError(503, 'QUEUE_UNAVAILABLE');
  const results: WorkflowRunFile[] = input.fileIds.map((id) => ({
    sourceName: owned.find((o) => o.id === id)?.name ?? '',
    status: 'pending',
    resultFileId: null,
    resultName: null,
    resultSize: null,
    savedTo: [],
    wouldSaveTo: [],
    failedStep: null,
    error: null,
  }));
  const id = randomUUID();
  ctx.db
    .insert(workflowRuns)
    .values({
      id,
      userId,
      workflowId: input.workflowId,
      name: input.name,
      steps: input.steps,
      keepOriginal: input.keepOriginal,
      test: input.test ?? false,
      toList: input.toList,
      dropInputs: input.dropInputs ?? false,
      fileIds: input.fileIds,
      results,
    })
    .run();
  try {
    await ctx.workflows.queue.enqueue(id);
  } catch {
    ctx.workflows.runner.update(id, { status: 'error', finishedAt: new Date() });
    throw new HttpError(503, 'QUEUE_UNAVAILABLE');
  }
  return toWorkflowRunDto(ownRun(ctx, userId, id));
}

export function ownRun(ctx: AppContext, userId: string, id: string) {
  const row = ctx.db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, id), eq(workflowRuns.userId, userId)))
    .get();
  if (!row) throw new HttpError(404, 'NOT_FOUND');
  return row;
}

export function listRuns(ctx: AppContext, userId: string) {
  return ctx.db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.userId, userId))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(30)
    .all()
    .map(toWorkflowRunDto);
}

/** Cancels a running run, or removes a finished one from the list. */
export async function cancelOrRemoveRun(ctx: AppContext, userId: string, id: string) {
  const row = ownRun(ctx, userId, id);
  if (row.status === 'queued' || row.status === 'running') {
    if (!ctx.workflows.runner.abort(id)) {
      await ctx.workflows.queue.removeWaiting(id);
      ctx.workflows.runner.update(id, { status: 'cancelled', finishedAt: new Date() });
    }
    return toWorkflowRunDto(ownRun(ctx, userId, id));
  }
  ctx.db.delete(workflowRuns).where(eq(workflowRuns.id, id)).run();
  return toWorkflowRunDto(row);
}

/** "Danach automatisch …": a saved workflow or quick steps, resolved for a run. */
export function resolveAfter(
  ctx: AppContext,
  userId: string,
  after: { workflowId: string } | { steps: WorkflowStep[] },
): Pick<RunInput, 'name' | 'workflowId' | 'steps' | 'keepOriginal'> {
  if ('workflowId' in after) {
    const wf = ownWorkflow(ctx, userId, after.workflowId);
    return {
      name: wf.name,
      workflowId: wf.id,
      steps: wf.steps as WorkflowStep[],
      keepOriginal: wf.keepOriginal,
    };
  }
  return { name: '', workflowId: null, steps: after.steps, keepOriginal: false };
}

/**
 * "Danach automatisch …" after a download or crawl: the files go through the
 * workflow; the storage locations chosen in the dialog come last (unless the
 * workflow saves there anyway). The downloaded originals are removed afterwards.
 */
export async function runAfter(
  ctx: AppContext,
  userId: string,
  after: { workflowId: string } | { steps: WorkflowStep[] },
  fileIds: string[],
  options: {
    toList: boolean;
    targetIds: string[];
    label: string;
    source?: string;
    /** Downloads: the platform's top folder ("Instagram", "4chan/g"). */
    platformFolder?: string;
    /** Downloads: a file already at the destination (same name and size) is skipped. */
    sameFileSkips?: boolean;
  },
) {
  const base = resolveAfter(ctx, userId, after);
  const saves = base.steps.filter(
    (s): s is Extract<WorkflowStep, { kind: 'save' }> => s.kind === 'save',
  );
  const covered = options.targetIds.every((t) => saves.some((s) => s.targetIds.includes(t)));
  const withSave: WorkflowStep[] =
    options.targetIds.length > 0 && !covered
      ? [...base.steps, { kind: 'save', targetIds: options.targetIds }]
      : base.steps;
  // Downloads keep their channel, profile or thread folder through the workflow.
  const steps =
    options.source || options.sameFileSkips || options.platformFolder
      ? withSave.map((s) =>
          s.kind === 'save'
            ? {
                ...s,
                ...(options.source && { source: options.source }),
                ...(options.platformFolder && { platformFolder: options.platformFolder }),
                ...(options.sameFileSkips && { sameFileSkips: true }),
              }
            : s,
        )
      : withSave;
  return startRun(ctx, userId, {
    ...base,
    name: base.name || options.label,
    steps,
    fileIds,
    toList: options.toList,
    dropInputs: true,
  });
}
