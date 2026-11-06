import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import { ProcessError, runProcess } from '../lib/run-process';

/**
 * Calibre's ebook-convert – only in the "full" Docker edition. Without it the
 * engine reports itself as unavailable and the router uses pandoc for EPUB.
 */
const EBOOK_CONVERT = process.env['CONBERT_EBOOK_CONVERT_PATH'] ?? 'ebook-convert';
const TIMEOUT_MS = 10 * 60 * 1000;

const READ = ['epub', 'mobi', 'azw3', 'fb2', 'docx', 'odt', 'rtf', 'txt', 'html', 'pdf'];
const WRITE = ['epub', 'mobi', 'azw3', 'fb2', 'pdf', 'docx', 'txt'];

let status: EngineStatus = 'uninitialized';

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'Calibre needs a file path and workDir');
  }
  const from = normalizeExt(req.inputExt);
  const to = normalizeExt(req.outputExt);
  const id = randomUUID();
  const dir = path.join(req.workDir, `calibre-${id}`);
  await mkdir(dir, { recursive: true });
  // ebook-convert decides by extension.
  const input = path.join(dir, `input.${from}`);
  const output = path.join(req.workDir, `${id}.${to}`);
  await copyFile(req.input, input);
  req.onProgress?.({ percent: 10, stage: 'converting' });
  try {
    await runProcess(EBOOK_CONVERT, [input, output], {
      timeoutMs: TIMEOUT_MS,
      signal: req.signal,
      cwd: dir,
      env: {
        ...process.env,
        HOME: dir,
        // PDF output uses Qt WebEngine: no display, no sandbox inside a container.
        QT_QPA_PLATFORM: 'offscreen',
        QTWEBENGINE_DISABLE_SANDBOX: '1',
        CALIBRE_CONFIG_DIRECTORY: path.join(dir, 'config'),
      },
    });
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    const details =
      error instanceof ProcessError
        ? `${error.result.stderr}\n${error.result.stdout}`.trim().slice(-2000) || error.message
        : String(error);
    throw new ConversionError(
      /DRM/i.test(details) ? 'errors.encrypted' : 'errors.convertFailed',
      details,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const calibreEngine: Engine = {
  id: 'calibre',
  name: 'Calibre',
  descriptionKey: 'engines.calibre.description',
  category: 'ebook',
  runtime: 'server',
  formats: [...new Set([...READ, ...WRITE])].map((ext) => ({
    ext,
    mime: getFormat(ext)?.mime ?? '',
    canRead: READ.includes(ext),
    canWrite: WRITE.includes(ext),
  })),
  options: [],
  supportsCompression: false,
  // Below pandoc (10) for documents, but the only engine for MOBI, AZW3, FB2.
  priority: 8,
  async init() {
    try {
      await runProcess(EBOOK_CONVERT, ['--version'], { timeoutMs: 30_000 });
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
