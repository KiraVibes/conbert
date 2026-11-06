import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  DOCUMENT_OPTIONS,
  PANDOC_METADATA_FILE,
  PANDOC_READERS,
  PANDOC_WRITERS,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  pandocArgs,
  pandocMetadataYaml,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import { ProcessError, runProcess } from '../lib/run-process';

const PANDOC = process.env['CONBERT_PANDOC_PATH'] ?? 'pandoc';
const TIMEOUT_MS = 120_000;

let status: EngineStatus = 'uninitialized';

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'pandoc needs a file path and workDir');
  }
  const from = normalizeExt(req.inputExt);
  const to = normalizeExt(req.outputExt);
  await mkdir(req.workDir, { recursive: true });
  const output = path.join(req.workDir, `${randomUUID()}.${to}`);
  // The file name is only a fallback: the document's own title wins.
  const title = typeof req.options['title'] === 'string' ? req.options['title'] : 'Dokument';
  const metadata = pandocMetadataYaml(from, to, req.options, title);
  if (metadata) await writeFile(path.join(req.workDir, PANDOC_METADATA_FILE), metadata);
  req.onProgress?.({ percent: 10, stage: 'converting' });
  try {
    await runProcess(
      PANDOC,
      [...pandocArgs(from, to, req.options, title), '-o', output, req.input],
      {
        timeoutMs: TIMEOUT_MS,
        signal: req.signal,
        cwd: req.workDir,
      },
    );
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    const details =
      error instanceof ProcessError ? error.result.stderr.trim() || error.message : String(error);
    throw new ConversionError('errors.convertFailed', details);
  }
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

const READ = Object.keys(PANDOC_READERS);
const WRITE = Object.keys(PANDOC_WRITERS);

export const pandocEngine: Engine = {
  id: 'pandoc',
  name: 'Pandoc',
  descriptionKey: 'engines.pandoc.description',
  category: 'document',
  runtime: 'server',
  formats: [...new Set([...READ, ...WRITE])].map((ext) => ({
    ext,
    mime: getFormat(ext)?.mime ?? '',
    canRead: READ.includes(ext),
    canWrite: WRITE.includes(ext),
  })),
  options: DOCUMENT_OPTIONS,
  supportsCompression: false,
  priority: 10,
  async init() {
    try {
      await runProcess(PANDOC, ['--version'], { timeoutMs: 10_000 });
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
