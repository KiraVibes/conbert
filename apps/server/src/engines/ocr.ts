import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ConversionError,
  OCR_OPTIONS,
  abortError,
  getFormat,
  isAbortError,
  ocrmypdfArgs,
  resolveOcr,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import { ProcessError, runProcess } from '../lib/run-process';

/**
 * OCR: ocrmypdf (Tesseract inside) puts an invisible text layer on scanned
 * PDFs, so they can be searched and copied from. Only used for jobs in the
 * "ocr" mode – the router never picks it for normal conversions (PDF → PDF).
 */
const OCRMYPDF = process.env['CONBERT_OCRMYPDF_PATH'] ?? 'ocrmypdf';
const TIMEOUT_MS = 30 * 60 * 1000;
/** Pages recognised at the same time (each Tesseract process needs ~0.5 GB). */
const JOBS = Math.min(4, os.availableParallelism());

let status: EngineStatus = 'uninitialized';

/** ocrmypdf's exit codes, see its documentation ("Return code policy"). */
function errorKey(code: number | null, details: string): string {
  if (code === 8 || /encrypt|password/i.test(details)) return 'errors.encrypted';
  if (code === 2) return 'errors.pdfBroken';
  if (code === 6) return 'errors.ocrHasText';
  if (code === 3) return 'errors.ocrMissing';
  return 'errors.ocrFailed';
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.ocrFailed', 'OCR needs a file path and workDir');
  }
  await mkdir(req.workDir, { recursive: true });
  const output = path.join(req.workDir, `${randomUUID()}.pdf`);
  req.onProgress?.({ percent: 5, stage: 'recognizing' });
  try {
    await runProcess(OCRMYPDF, ocrmypdfArgs(req.input, output, resolveOcr(req.options), JOBS), {
      timeoutMs: TIMEOUT_MS,
      signal: req.signal,
    });
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    if (error instanceof ProcessError) {
      const details = `${error.result.stderr}\n${error.result.stdout}`.trim().slice(-2000);
      throw new ConversionError(errorKey(error.result.code, details), details || error.message);
    }
    throw new ConversionError('errors.ocrFailed', String(error));
  }
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const ocrEngine: Engine = {
  id: 'ocrmypdf',
  name: 'OCRmyPDF + Tesseract',
  descriptionKey: 'engines.ocrmypdf.description',
  category: 'pdf',
  runtime: 'server',
  formats: [{ ext: 'pdf', mime: getFormat('pdf')?.mime ?? '', canRead: true, canWrite: true }],
  options: OCR_OPTIONS,
  supportsCompression: false,
  priority: 1,
  async init() {
    try {
      await runProcess(OCRMYPDF, ['--version'], { timeoutMs: 20_000 });
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
