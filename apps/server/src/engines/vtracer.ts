import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  ConversionError,
  VECTOR_OPTIONS,
  abortError,
  getFormat,
  isAbortError,
  resolveVectorOptions,
  vtracerArgs,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import { ProcessError, runProcess } from '../lib/run-process';

const VTRACER = process.env['CONBERT_VTRACER_PATH'] ?? 'vtracer';
/** The finest level on a 4096-pixel picture can take a few minutes. */
const TIMEOUT_MS = 600_000;
const READ = ['png', 'jpg', 'webp', 'gif', 'tiff', 'avif', 'bmp'];

let status: EngineStatus = 'uninitialized';

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'vtracer needs a file path and workDir');
  }
  await mkdir(req.workDir, { recursive: true });
  const id = randomUUID();
  const prepared = path.join(req.workDir, `${id}-input.png`);
  const output = path.join(req.workDir, `${id}.svg`);
  const options = resolveVectorOptions(req.options);
  const { maxSide, enlarge } = options.traceSize;
  req.onProgress?.({ percent: 10, stage: 'converting' });
  try {
    // Normalize to a PNG of the chosen tracing size. Enlarging small pictures
    // first gives vtracer more pixels per curve, so the outlines get finer.
    await sharp(req.input, { failOn: 'error' })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: !enlarge })
      .png()
      .toFile(prepared);
    if (req.signal?.aborted) throw abortError();
    req.onProgress?.({ percent: 30, stage: 'converting' });
    await runProcess(VTRACER, ['--input', prepared, '--output', output, ...vtracerArgs(options)], {
      timeoutMs: TIMEOUT_MS,
      signal: req.signal,
    });
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    const details =
      error instanceof ProcessError ? error.result.stderr.trim() || error.message : String(error);
    throw new ConversionError('errors.convertFailed', details);
  } finally {
    await rm(prepared, { force: true });
  }
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const vtracerEngine: Engine = {
  id: 'vtracer',
  name: 'VTracer',
  descriptionKey: 'engines.vtracer.description',
  category: 'vector',
  runtime: 'server',
  formats: [
    ...READ.map((ext) => ({
      ext,
      mime: getFormat(ext)?.mime ?? '',
      canRead: true,
      canWrite: false,
    })),
    { ext: 'svg', mime: 'image/svg+xml', canRead: false, canWrite: true },
  ],
  options: VECTOR_OPTIONS,
  supportsCompression: false,
  priority: 10,
  async init() {
    try {
      await runProcess(VTRACER, ['--help'], { timeoutMs: 10_000 });
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
