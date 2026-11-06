import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { Encrypter } from 'age-encryption';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';
import {
  ConversionError,
  compressionOptions,
  cropBox,
  defaultOptions,
  describeEngine,
  downloadFolder,
  encryptedName,
  filterNeedsWidth,
  findRoutes,
  extFromName,
  getFormat,
  identifyFile,
  isAbortError,
  isAgeRecipient,
  MAX_REPAIR_BYTES,
  repairFile,
  matchesFilter,
  parseStructure,
  normalizeExt,
  outputFileName,
  renameWith,
  type WorkflowStep,
} from '@conbert/core';
import type { WorkflowRunDto, WorkflowRunFile } from '@conbert/schemas';
import { dataPaths } from '../config';
import type { AppContext } from '../context';
import {
  files,
  storageTargets,
  workflowRuns,
  type FileRecord,
  type WorkflowRunRecord,
} from '../db/schema';
import { withFileReader } from '../lib/file-reader';
import { ownKey, sharedKeys } from '../routes/keys';
import { API_ERROR_KEYS, HttpError } from '../lib/http-error';
import { ProcessError, runProcess } from '../lib/run-process';
import { notify } from '../notifications/service';
import type { JobEvents } from '../queue/events';
import { deleteFileRecord, recordFile } from '../storage/uploads';
import { exportFile } from '../targets/export';

/** The file as it moves through the steps. */
interface Current {
  path: string;
  name: string;
  ext: string;
  /** Still the input file (nothing changed it yet). */
  original: boolean;
}

/** Formats sharp can read and write again (resize, rotate). */
const SHARP_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tif', 'tiff', 'gif']);

export function toWorkflowRunDto(row: WorkflowRunRecord): WorkflowRunDto {
  const results = row.results as WorkflowRunFile[];
  return {
    id: row.id,
    workflowId: row.workflowId,
    name: row.name,
    status: row.status,
    test: row.test,
    toList: row.toList,
    total: results.length,
    done: results.filter((r) => r.status === 'done').length,
    failed: results.filter((r) => r.status === 'error').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    files: results,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

class StepError extends Error {
  constructor(
    readonly messageKey: string,
    readonly details?: string,
  ) {
    super(messageKey);
  }
}

/** Runs workflow runs waiting in the queue (one at a time). */
export class WorkflowRunner {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly ctx: AppContext,
    private readonly events: JobEvents,
  ) {}

  row(id: string): WorkflowRunRecord | undefined {
    return this.ctx.db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get();
  }

  update(id: string, patch: Partial<WorkflowRunRecord>): WorkflowRunRecord | undefined {
    this.ctx.db.update(workflowRuns).set(patch).where(eq(workflowRuns.id, id)).run();
    const row = this.row(id);
    if (row) this.events.emit('workflow', row.userId, toWorkflowRunDto(row));
    return row;
  }

  abort(id: string): boolean {
    const controller = this.running.get(id);
    controller?.abort();
    return controller !== undefined;
  }

  async run(id: string): Promise<void> {
    const row = this.row(id);
    if (!row || row.status !== 'queued') return;
    const controller = new AbortController();
    this.running.set(id, controller);
    const signal = controller.signal;
    const steps = row.steps as WorkflowStep[];
    const results = row.results as WorkflowRunFile[];
    const fileIds = row.fileIds as string[];
    const base = path.join(dataPaths(this.ctx.config).tmp, `workflow-${id}`);
    const channels = new Set<string>();
    this.update(id, { status: 'running' });
    try {
      for (const [index, fileId] of fileIds.entries()) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError');
        const result = results[index];
        // Files finished before a restart are not processed twice.
        if (!result || result.status !== 'pending') continue;
        const record = this.ctx.db
          .select()
          .from(files)
          .where(and(eq(files.id, fileId), eq(files.userId, row.userId)))
          .get();
        if (!record) {
          Object.assign(result, { status: 'error', error: { messageKey: 'errors.resultGone' } });
          this.update(id, { results });
          continue;
        }
        const workDir = path.join(base, String(index));
        await mkdir(workDir, { recursive: true });
        try {
          await this.runFile(row, record, steps, result, workDir, index, channels, signal);
        } catch (error) {
          if (signal.aborted || isAbortError(error)) throw error;
          result.status = 'error';
          result.error =
            error instanceof StepError
              ? {
                  messageKey: error.messageKey,
                  ...(error.details && { details: error.details.slice(0, 1000) }),
                }
              : error instanceof ConversionError
                ? {
                    messageKey: error.messageKey,
                    ...(error.details && { details: error.details.slice(0, 1000) }),
                  }
                : error instanceof HttpError
                  ? {
                      messageKey: API_ERROR_KEYS[error.code],
                      ...(error.details && { details: error.details }),
                    }
                  : {
                      messageKey: 'errors.convertFailed',
                      details:
                        error instanceof Error ? error.message.slice(0, 1000) : String(error),
                    };
        }
        this.update(id, { results });
      }
      const finished = this.update(id, { status: 'done', results, finishedAt: new Date() });
      if (row.dropInputs) await this.dropInputs(row, results);
      if (finished && !row.test) await this.report(finished, channels);
    } catch (error) {
      const cancelled = signal.aborted || isAbortError(error);
      for (const r of results)
        if (r.status === 'pending') r.status = cancelled ? 'skipped' : 'error';
      this.update(id, {
        status: cancelled ? 'cancelled' : 'error',
        results,
        finishedAt: new Date(),
      });
    } finally {
      this.running.delete(id);
      await rm(base, { recursive: true, force: true });
    }
  }

  private async runFile(
    row: WorkflowRunRecord,
    record: FileRecord,
    steps: WorkflowStep[],
    result: WorkflowRunFile,
    workDir: string,
    index: number,
    channels: Set<string>,
    signal: AbortSignal,
  ): Promise<void> {
    let current: Current = {
      path: record.path,
      name: record.originalName,
      ext: normalizeExt(record.ext),
      original: true,
    };
    for (const [stepIndex, step] of steps.entries()) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      try {
        const next = await this.step(row, record, step, current, result, workDir, index, signal);
        if (next === 'stop') {
          result.status = current.original ? 'skipped' : 'done';
          break;
        }
        if (step.kind === 'notify') step.channelIds.forEach((c) => channels.add(c));
        current = next;
      } catch (error) {
        result.failedStep = stepIndex;
        throw error;
      }
    }
    if (result.status === 'pending') result.status = 'done';
    // Results go back to the list (or are shown in the test run).
    if ((row.toList || row.test) && result.status === 'done') {
      if (current.original) {
        result.resultFileId = record.id;
        result.resultName = record.originalName;
        result.resultSize = record.size;
      } else {
        const fileId = randomUUID();
        const target = path.join(dataPaths(this.ctx.config).uploads, fileId);
        await copyFile(current.path, target);
        const size = (await stat(target)).size;
        const saved = await recordFile(this.ctx, {
          id: fileId,
          userId: row.userId,
          filePath: target,
          name: current.name,
          size,
        });
        result.resultFileId = fileId;
        result.resultName = saved.originalName;
        result.resultSize = size;
      }
    }
  }

  private async step(
    row: WorkflowRunRecord,
    record: FileRecord,
    step: WorkflowStep,
    current: Current,
    result: WorkflowRunFile,
    workDir: string,
    index: number,
    signal: AbortSignal,
  ): Promise<Current | 'stop'> {
    const out = (ext: string) => path.join(workDir, `${randomUUID()}.${ext}`);
    switch (step.kind) {
      case 'filter': {
        const size = (await stat(current.path)).size;
        const width =
          filterNeedsWidth(step.rule) && getFormat(current.ext)?.category === 'image'
            ? ((
                await sharp(current.path)
                  .metadata()
                  .catch(() => null)
              )?.width ?? null)
            : null;
        return matchesFilter(step.rule, { ext: current.ext, size, width }) ? current : 'stop';
      }
      case 'convert': {
        const to = normalizeExt(step.outputExt);
        if (to === current.ext) return current;
        const file = await this.convert(current, to, step.options, workDir, signal, false);
        return { path: file, name: outputFileName(current.name, to), ext: to, original: false };
      }
      case 'compress': {
        const options = {
          ...compressionOptions(current.ext, {
            level: step.preset as 'max' | 'balanced' | 'small',
            stripMetadata: true,
          }),
          ...step.options,
        };
        const file = await this.convert(current, current.ext, options, workDir, signal, true);
        // Never worse: a bigger result keeps the file as it was.
        if ((await stat(file)).size >= (await stat(current.path)).size) return current;
        return { ...current, path: file, original: false };
      }
      case 'edit':
        return this.edit(step, current, out, index, signal);
      case 'ocr':
        return this.ocr(step.options, current, workDir, signal);
      case 'save': {
        const names = this.targetNames(row.userId, step.targetIds);
        if (row.test) {
          result.wouldSaveTo.push(...names.filter((n) => !result.wouldSaveTo.includes(n)));
          return current;
        }
        const category = getFormat(current.ext)?.category;
        const folder = step.subfolderPattern
          ? downloadFolder(step.subfolderPattern, {
              date: new Date(),
              ext: current.ext,
              ...(category && { category }),
              ...(step.source && { source: step.source }),
              ...(step.platformFolder && { platformFolder: step.platformFolder }),
            })
          : undefined;
        const sources = [
          { filePath: current.path, name: current.name, ext: current.ext },
          // "Original behalten": the untouched file goes along.
          ...(row.keepOriginal && !current.original
            ? [{ filePath: record.path, name: record.originalName, ext: normalizeExt(record.ext) }]
            : []),
        ];
        for (const source of sources) {
          const saved = await exportFile(
            this.ctx,
            row.userId,
            source,
            {
              targetIds: step.targetIds,
              ...(folder !== undefined && { folder }),
              ...(category && { category }),
            },
            {
              source: step.source,
              platformFolder: step.platformFolder,
              sameFileSkips: step.sameFileSkips === true,
            },
          );
          const failed = saved.find((s) => s.status === 'error');
          if (failed)
            throw new StepError(
              failed.error?.messageKey ?? API_ERROR_KEYS.WORKFLOW_SAVE_FAILED,
              failed.error?.details,
            );
          for (const s of saved) {
            const name = names[step.targetIds.indexOf(s.targetId)];
            if (name && !result.savedTo.includes(name)) result.savedTo.push(name);
          }
        }
        return current;
      }
      case 'notify':
        return current;
      case 'workshop':
        if (step.trick === 'fix-extension') return this.fixExtension(current);
        if (step.trick === 'strip-appended') return this.stripAppended(current, out);
        if (step.trick === 'repair') return this.repair(current, out);
        if (step.trick === 'encrypt')
          return this.encrypt(row.userId, step.params, current, workDir);
        throw new StepError(API_ERROR_KEYS.WORKFLOW_STEP_UNAVAILABLE, step.trick);
    }
  }

  /** Text recognition: PDFs get a searchable text layer, other files go on unchanged. */
  private async ocr(
    options: Record<string, unknown>,
    current: Current,
    workDir: string,
    signal: AbortSignal,
  ): Promise<Current> {
    if (current.ext !== 'pdf') return current;
    const engine = this.ctx.engines.find((e) => e.id === 'ocrmypdf');
    if (!engine || engine.status() === 'error') {
      throw new StepError(API_ERROR_KEYS.WORKFLOW_STEP_UNAVAILABLE, 'ocrmypdf');
    }
    const output = await engine.convert({
      input: current.path,
      inputExt: 'pdf',
      outputExt: 'pdf',
      options: { ...defaultOptions(engine.options, 'pdf'), ...options },
      workDir,
      signal,
    });
    if (typeof output !== 'string') throw new ConversionError('errors.ocrFailed', 'no file');
    return { ...current, path: output, original: false };
  }

  /** Workshop trick: the name gets the extension of the real content. */
  private async fixExtension(current: Current): Promise<Current> {
    const head = await withFileReader(current.path, (r) => r.read(0, 4096));
    const detected = await fileTypeFromFile(current.path).catch(() => undefined);
    const identity = identifyFile({ name: current.name, detectedExt: detected?.ext ?? null, head });
    if (!identity.suggestedName) return current;
    const ext = extFromName(identity.suggestedName) ?? current.ext;
    // A new name counts as a change, so the result is kept under it.
    return { ...current, name: identity.suggestedName, ext, original: false };
  }

  /**
   * Workshop trick: encrypt with age for the chosen people – only public
   * keys are needed, so it runs without anyone's vault being open.
   */
  private async encrypt(
    userId: string,
    params: Record<string, unknown>,
    current: Current,
    workDir: string,
  ): Promise<Current> {
    const recipients = new Set<string>();
    if (params['self'] === true) {
      const own = ownKey(this.ctx, userId);
      if (own) recipients.add(own.publicKey);
    }
    const userIds = Array.isArray(params['userIds']) ? params['userIds'].map(String) : [];
    // Only keys their owners shared – nobody can be chosen behind their back.
    for (const key of sharedKeys(this.ctx, userId)) {
      if (userIds.includes(key.userId)) recipients.add(key.publicKey);
    }
    const pasted = Array.isArray(params['recipients']) ? params['recipients'].map(String) : [];
    for (const key of pasted) if (isAgeRecipient(key)) recipients.add(key.trim());
    if (recipients.size === 0) throw new StepError(API_ERROR_KEYS.KEY_NO_RECIPIENTS);

    const encrypter = new Encrypter();
    for (const r of recipients) encrypter.addRecipient(r);
    const file = path.join(workDir, `${randomUUID()}.age`);
    const input = Readable.toWeb(createReadStream(current.path)) as ReadableStream<Uint8Array>;
    const encrypted = await encrypter.encrypt(input);
    await pipeline(
      Readable.fromWeb(encrypted as NodeReadableStream<Uint8Array>),
      createWriteStream(file),
    );
    return { path: file, name: encryptedName(current.name), ext: 'age', original: false };
  }

  /**
   * Workshop trick: repair what can be repaired safely (checksums, cut-off
   * pictures, extension). Data behind the end stays – "strip-appended" is
   * there for that.
   */
  private async repair(current: Current, out: (ext: string) => string): Promise<Current> {
    if ((await stat(current.path)).size > MAX_REPAIR_BYTES) return current;
    const detected = await fileTypeFromFile(current.path).catch(() => undefined);
    const bytes = new Uint8Array(await readFile(current.path));
    const r = await repairFile(bytes, current.name, detected?.ext ?? null, { cutAppended: false });
    if (!r.bytes) return current;
    const ext = extFromName(r.name) ?? current.ext;
    if (r.bytes === bytes) return { ...current, name: r.name, ext, original: false };
    const file = out(ext);
    await writeFile(file, r.bytes);
    return { path: file, name: r.name, ext, original: false };
  }

  /** Workshop trick: cut off whatever hangs behind the format's own end. */
  private async stripAppended(current: Current, out: (ext: string) => string): Promise<Current> {
    const structure = await withFileReader(current.path, (r) => parseStructure(r, current.ext));
    const end = structure?.appendedAt;
    if (end == null || end <= 0) return current;
    const file = out(current.ext);
    await pipeline(createReadStream(current.path, { end: end - 1 }), createWriteStream(file));
    return { ...current, path: file, original: false };
  }

  private async edit(
    step: Extract<WorkflowStep, { kind: 'edit' }>,
    current: Current,
    out: (ext: string) => string,
    index: number,
    signal: AbortSignal,
  ): Promise<Current> {
    const num = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
    switch (step.action) {
      case 'rename': {
        const pattern =
          typeof step.params['pattern'] === 'string' ? step.params['pattern'] : '{name}';
        const name = `${renameWith(pattern, current.name, index + 1, new Date())}.${current.ext}`;
        // A new name counts as a change, so the result is kept under it.
        return { ...current, name, original: false };
      }
      case 'resize':
      case 'crop':
      case 'rotate': {
        // Only pictures – everything else goes on unchanged.
        if (!SHARP_FORMATS.has(current.ext)) return current;
        const file = out(current.ext);
        let image = sharp(current.path, {
          animated: current.ext === 'gif' || current.ext === 'webp',
        });
        if (step.action === 'resize') {
          const width = num(step.params['maxWidth']);
          const height = num(step.params['maxHeight']);
          if (!width && !height) return current;
          image = image.resize({ width, height, fit: 'inside', withoutEnlargement: true });
        } else if (step.action === 'crop') {
          const meta = await sharp(current.path).metadata();
          // EXIF orientation 5–8: the picture is shown turned by 90°.
          const turned = (meta.orientation ?? 1) >= 5;
          const frameHeight = meta.pageHeight ?? meta.height;
          const box = cropBox(
            (turned ? frameHeight : meta.width) ?? 0,
            (turned ? meta.width : frameHeight) ?? 0,
            String(step.params['ratio'] ?? '1:1'),
          );
          if (!box) return current;
          image = image.rotate().resize({
            width: box.width,
            height: box.height,
            fit: 'cover',
            position: step.params['focus'] === 'attention' ? sharp.strategy.attention : 'centre',
          });
        } else {
          const degrees = Number(step.params['degrees']);
          image = image.rotate([90, 180, 270].includes(degrees) ? degrees : 90);
        }
        await image.toFile(file);
        return { ...current, path: file, original: false };
      }
      case 'strip-metadata': {
        const file = out(current.ext);
        await copyFile(current.path, file);
        try {
          await runProcess(
            'exiftool',
            ['-all=', '-overwrite_original', '-q', '-q', '-m', '--', file],
            {
              timeoutMs: 60_000,
              signal,
            },
          );
        } catch (error) {
          const missing = error instanceof ProcessError && error.reason === 'spawn';
          // ExifTool can't write this format: the file goes on as it is.
          if (!missing) return current;
          // No ExifTool (development): pictures are written again without metadata.
          if (!SHARP_FORMATS.has(current.ext)) {
            throw new StepError(API_ERROR_KEYS.WORKFLOW_STEP_UNAVAILABLE, 'exiftool');
          }
          await sharp(current.path).toFile(file);
        }
        return { ...current, path: file, original: false };
      }
    }
  }

  /** Server conversion along the router's route (same as a normal server job). */
  private async convert(
    current: Current,
    to: string,
    options: Record<string, unknown>,
    workDir: string,
    signal: AbortSignal,
    compress: boolean,
  ): Promise<string> {
    const [route] = findRoutes(this.ctx.engines.map(describeEngine), current.ext, to, 'server', {
      compress,
    });
    if (!route) throw new StepError(API_ERROR_KEYS.NO_SERVER_ROUTE, `${current.ext} → ${to}`);
    let input = current.path;
    for (const [i, step] of route.steps.entries()) {
      const engine = this.ctx.engines.find((e) => e.id === step.engineId);
      if (!engine) throw new StepError(API_ERROR_KEYS.NO_SERVER_ROUTE, step.engineId);
      const last = i === route.steps.length - 1;
      const output = await engine.convert({
        input,
        inputExt: step.from,
        outputExt: step.to,
        options: last
          ? {
              ...defaultOptions(engine.options, step.to),
              title: current.name.replace(/\.[^.]+$/, ''),
              ...options,
            }
          : defaultOptions(engine.options, step.to),
        workDir,
        signal,
      });
      if (typeof output !== 'string') throw new ConversionError('errors.convertFailed', 'no file');
      input = output;
    }
    return input;
  }

  private targetNames(userId: string, ids: string[]): string[] {
    if (ids.length === 0) return [];
    const rows = this.ctx.db
      .select({ id: storageTargets.id, name: storageTargets.name })
      .from(storageTargets)
      .where(and(eq(storageTargets.userId, userId), inArray(storageTargets.id, ids)))
      .all();
    return ids.map((id) => rows.find((r) => r.id === id)?.name ?? '?');
  }

  /** Downloads that only went through the workflow: their files leave the server. */
  private async dropInputs(row: WorkflowRunRecord, results: WorkflowRunFile[]) {
    const keep = new Set(results.map((r) => r.resultFileId));
    for (const fileId of row.fileIds as string[]) {
      if (keep.has(fileId)) continue;
      const record = this.ctx.db.select().from(files).where(eq(files.id, fileId)).get();
      if (record) await deleteFileRecord(this.ctx, record);
    }
  }

  /** "Batch fertig" (and errors) to the chosen or subscribed channels. */
  private async report(row: WorkflowRunRecord, channels: Set<string>) {
    const dto = toWorkflowRunDto(row);
    const values = { name: dto.name, done: dto.done, failed: dto.failed, skipped: dto.skipped };
    await notify(
      this.ctx,
      row.userId,
      {
        event: dto.failed > 0 ? 'error' : 'batch-done',
        titleKey: 'notifications.workflowDone.title',
        bodyKey:
          dto.failed > 0
            ? 'notifications.workflowDone.bodyErrors'
            : 'notifications.workflowDone.body',
        values,
      },
      channels.size > 0 ? { channelIds: [...channels] } : {},
    );
  }
}

/**
 * After a restart: workflow runs go on with the files that were not finished
 * yet, waiting runs are queued again.
 */
export async function resumeWorkflowRuns(ctx: AppContext): Promise<void> {
  const rows = ctx.db
    .select({ id: workflowRuns.id, status: workflowRuns.status })
    .from(workflowRuns)
    .where(inArray(workflowRuns.status, ['queued', 'running']))
    .all();
  for (const row of rows) {
    if (row.status === 'running') ctx.workflows.runner.update(row.id, { status: 'queued' });
    await ctx.workflows.queue.enqueue(row.id).catch(() => undefined);
  }
}
