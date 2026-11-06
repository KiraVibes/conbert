import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  PDF_COMPRESS_OPTIONS,
  PDF_RENDER_OPTIONS,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  resolvePdfQuality,
  resolvePdfRender,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import { ProcessError, runProcess } from '../lib/run-process';

/**
 * PDF tools on the server: Ghostscript shrinks PDFs (pictures to 300/150/72
 * dpi) and renders pages as pictures; qpdf restructures PDFs without any
 * quality loss. One engine, because the compress levels need both.
 * Ghostscript always runs with -dSAFER (no file access outside its job).
 */
const GS = process.env['CONBERT_GS_PATH'] ?? 'gs';
const QPDF = process.env['CONBERT_QPDF_PATH'] ?? 'qpdf';
const TIMEOUT_MS = 5 * 60 * 1000;

let status: EngineStatus = 'uninitialized';

function detailsOf(error: unknown): string {
  return error instanceof ProcessError
    ? `${error.result.stderr}\n${error.result.stdout}`.trim().slice(-2000) || error.message
    : String(error);
}

async function compress(req: ConvertRequest & { input: string }, output: string): Promise<void> {
  const quality = resolvePdfQuality(req.options);
  if (quality === 'lossless') {
    await runProcess(
      QPDF,
      [
        '--object-streams=generate',
        '--compress-streams=y',
        '--recompress-flate',
        '--compression-level=9',
        '--linearize',
        '--',
        req.input,
        output,
      ],
      { timeoutMs: TIMEOUT_MS, signal: req.signal },
    ).catch((error: unknown) => {
      // qpdf exit code 3 = finished with warnings – the file is fine.
      if (error instanceof ProcessError && error.result.code === 3) return;
      throw error;
    });
    return;
  }
  await runProcess(
    GS,
    [
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-dQUIET',
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.7',
      `-dPDFSETTINGS=/${quality}`,
      '-dDetectDuplicateImages=true',
      `-sOutputFile=${output}`,
      '-f',
      req.input,
    ],
    { timeoutMs: TIMEOUT_MS, signal: req.signal },
  );
}

async function render(
  req: ConvertRequest & { input: string },
  output: string,
  to: string,
): Promise<void> {
  const { page, dpi } = resolvePdfRender(req.options);
  await runProcess(
    GS,
    [
      '-dSAFER',
      '-dBATCH',
      '-dNOPAUSE',
      '-dQUIET',
      to === 'png' ? '-sDEVICE=png16m' : '-sDEVICE=jpeg',
      ...(to === 'jpg' ? ['-dJPEGQ=90'] : []),
      `-r${dpi}`,
      '-dTextAlphaBits=4',
      '-dGraphicsAlphaBits=4',
      `-dFirstPage=${page}`,
      `-dLastPage=${page}`,
      `-sOutputFile=${output}`,
      '-f',
      req.input,
    ],
    { timeoutMs: TIMEOUT_MS, signal: req.signal },
  );
  // Ghostscript writes nothing (and still succeeds) when the page doesn't exist.
  const size = await stat(output)
    .then((s) => s.size)
    .catch(() => 0);
  if (size === 0) throw new ConversionError('errors.convertFailed', `page ${page} does not exist`);
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'PDF tools need a file path and workDir');
  }
  const to = normalizeExt(req.outputExt);
  await mkdir(req.workDir, { recursive: true });
  const output = path.join(req.workDir, `${randomUUID()}.${to}`);
  const job = { ...req, input: req.input };
  req.onProgress?.({ percent: 10, stage: 'converting' });
  try {
    if (to === 'pdf') await compress(job, output);
    else await render(job, output, to);
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    if (error instanceof ConversionError) throw error;
    const details = detailsOf(error);
    throw new ConversionError(
      /password|encrypt/i.test(details) ? 'errors.encrypted' : 'errors.convertFailed',
      details,
    );
  }
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const pdfToolsEngine: Engine = {
  id: 'pdf-tools',
  name: 'Ghostscript + qpdf',
  descriptionKey: 'engines.pdfTools.description',
  category: 'pdf',
  runtime: 'server',
  formats: [
    { ext: 'pdf', mime: getFormat('pdf')?.mime ?? '', canRead: true, canWrite: true },
    { ext: 'png', mime: 'image/png', canRead: false, canWrite: true },
    { ext: 'jpg', mime: 'image/jpeg', canRead: false, canWrite: true },
  ],
  options: [...PDF_COMPRESS_OPTIONS, ...PDF_RENDER_OPTIONS],
  supportsCompression: true,
  priority: 10,
  async init() {
    try {
      await runProcess(GS, ['--version'], { timeoutMs: 10_000 });
      await runProcess(QPDF, ['--version'], { timeoutMs: 10_000 });
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
