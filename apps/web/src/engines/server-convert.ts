import * as tus from 'tus-js-client';
import { ConversionError, abortError, type ConvertProgress } from '@conbert/core';
import { jobResponseSchema, type JobDto } from '@conbert/schemas';
import { ApiRequestError, apiDelete, apiGet, apiPost } from '@/lib/api';
import { subscribeToJob } from '@/lib/job-socket';

/** Fallback polling in case the WebSocket is blocked (some proxies do that). */
const POLL_INTERVAL_MS = 2_000;

/** Uploads per File, so trying again or another format doesn't upload twice. */
const uploads = new WeakMap<Blob, Promise<string>>();

/**
 * Results made on the server, with their job: saving one to a storage
 * location lets the server copy it, instead of uploading it again.
 */
const serverResults = new WeakMap<Blob, string>();

/** A file that is on the server already (e.g. opened from a storage location). */
export function rememberServerFile(file: Blob, fileId: string): void {
  uploads.set(file, Promise.resolve(fileId));
}

/** The server job that made this result – unchanged since (same Blob). */
export function serverJobOf(result: Blob): string | undefined {
  return serverResults.get(result);
}

function toConversionError(error: unknown): ConversionError {
  if (error instanceof ConversionError) return error;
  if (error instanceof ApiRequestError) return new ConversionError(error.messageKey, error.details);
  if (error instanceof tus.DetailedError) {
    const status = error.originalResponse?.getStatus();
    if (status === 413) {
      // Over the storage quota or simply too big – the server says which.
      const quota = error.originalResponse?.getBody().includes('QUOTA_EXCEEDED');
      return new ConversionError(
        quota ? 'errors.quotaExceeded' : 'errors.fileTooLarge',
        error.message,
      );
    }
    if (status === 401) return new ConversionError('errors.unauthorized', error.message);
    return new ConversionError('errors.network', error.message);
  }
  return new ConversionError('errors.convertFailed', String(error));
}

export function uploadToServer(
  file: Blob,
  name: string,
  signal: AbortSignal | undefined,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const cached = uploads.get(file);
  if (cached) return cached;
  const promise = new Promise<string>((resolve, reject) => {
    const task = new tus.Upload(file, {
      endpoint: '/api/upload',
      metadata: { filename: name, filetype: file.type },
      retryDelays: [0, 1000, 3000, 5000],
      removeFingerprintOnSuccess: true,
      onProgress: (sent, total) => onProgress(total > 0 ? sent / total : 0),
      onSuccess: () => {
        const id = task.url?.split('/').pop();
        if (id) resolve(id);
        else reject(new ConversionError('errors.badResponse', 'upload without id'));
      },
      onError: (error) => reject(toConversionError(error)),
    });
    signal?.addEventListener('abort', () => {
      void task.abort(true);
      reject(abortError());
    });
    void task
      .findPreviousUploads()
      .then((previous) => {
        // Resume an interrupted upload of the same file instead of starting over.
        const [last] = previous;
        if (last) task.resumeFromPreviousUpload(last);
        task.start();
      })
      .catch(() => task.start());
  });
  uploads.set(file, promise);
  // A failed or cancelled upload must not be reused.
  promise.catch(() => uploads.delete(file));
  return promise;
}

/** Removes a file from the server early (when it is removed from the list). */
export function forgetUpload(file: Blob): void {
  const pending = uploads.get(file);
  uploads.delete(file);
  void pending?.then((id) => apiDelete(`/api/files/${id}`)).catch(() => undefined);
}

function waitForJob(
  job: JobDto,
  signal: AbortSignal | undefined,
  onJob: (job: JobDto) => void,
): Promise<JobDto> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (fn: () => void) => {
      if (finished) return;
      finished = true;
      unsubscribe();
      clearInterval(poll);
      fn();
    };
    const handle = (update: JobDto) => {
      onJob(update);
      if (update.status === 'done') finish(() => resolve(update));
      else if (update.status === 'error')
        finish(() =>
          reject(
            new ConversionError(
              update.error?.messageKey ?? 'errors.convertFailed',
              update.error?.details,
            ),
          ),
        );
      else if (update.status === 'cancelled') finish(() => reject(abortError()));
    };
    const unsubscribe = subscribeToJob(job.id, handle);
    const poll = setInterval(() => {
      apiGet(`/api/jobs/${job.id}`, jobResponseSchema)
        .then((res) => handle(res.job))
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
    signal?.addEventListener('abort', () => {
      void apiDelete(`/api/jobs/${job.id}`).catch(() => undefined);
      finish(() => reject(abortError()));
    });
    handle(job);
  });
}

async function downloadResult(jobId: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`/api/jobs/${jobId}/result`, { credentials: 'same-origin' });
  } catch (error) {
    throw new ConversionError('errors.network', String(error));
  }
  if (!response.ok) {
    throw new ConversionError(
      response.status === 410 ? 'errors.resultGone' : 'errors.internal',
      response.statusText,
    );
  }
  return response.blob();
}

export interface ServerConvertRequest {
  file: Blob;
  fileName: string;
  outputExt: string;
  options: Record<string, unknown>;
  /** "compress" lets the server re-encode in the same format, "ocr" makes PDFs searchable. */
  mode?: 'convert' | 'compress' | 'ocr';
  signal?: AbortSignal;
  onProgress?: (p: ConvertProgress) => void;
}

/**
 * Converts a file on the Conbert server: upload (tus) → job → live progress
 * (WebSocket, polling as fallback) → download. The server picks the engines
 * and builds chains itself.
 */
export async function convertOnServer(req: ServerConvertRequest): Promise<Blob> {
  const { signal, onProgress } = req;
  if (signal?.aborted) throw abortError();
  try {
    onProgress?.({ percent: 0, stage: 'uploading' });
    const upload = () =>
      uploadToServer(req.file, req.fileName, signal, (f) =>
        onProgress?.({ percent: Math.round(f * 40), stage: 'uploading' }),
      );
    // Files chosen in options (subtitles to burn in …) go up as their own uploads.
    const options: Record<string, unknown> = {};
    const attachments: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.options)) {
      if (value instanceof Blob) {
        const name = value instanceof File ? value.name : key;
        attachments[key] = await uploadToServer(value, name, signal, () => undefined);
      } else {
        options[key] = value;
      }
    }
    const createJob = (fileId: string) =>
      apiPost(
        '/api/jobs',
        { fileId, outputExt: req.outputExt, options, attachments, mode: req.mode ?? 'convert' },
        jobResponseSchema,
      );
    // Known from before: the server may have tidied it away in the meantime.
    const known = uploads.has(req.file);
    let fileId = await upload();
    if (signal?.aborted) throw abortError();

    let job: JobDto;
    try {
      ({ job } = await createJob(fileId));
    } catch (error) {
      if (!known || !(error instanceof ApiRequestError) || error.status !== 404) throw error;
      uploads.delete(req.file);
      fileId = await upload();
      if (signal?.aborted) throw abortError();
      ({ job } = await createJob(fileId));
    }
    const done = await waitForJob(job, signal, (update) => {
      const stage = update.status === 'queued' ? 'queued' : (update.stage ?? 'converting');
      onProgress?.({ percent: 40 + Math.round(update.progress * 0.5), stage });
    });
    onProgress?.({ percent: 92, stage: 'downloading' });
    const blob = await downloadResult(done.id);
    serverResults.set(blob, done.id);
    onProgress?.({ percent: 100, stage: 'done' });
    return blob;
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw abortError();
    }
    throw toConversionError(error);
  }
}
