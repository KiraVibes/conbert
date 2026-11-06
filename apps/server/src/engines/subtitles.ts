import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  SUBTITLE_OPTIONS,
  SUBTITLE_READ,
  SUBTITLE_WRITE,
  abortError,
  getFormat,
  normalizeExt,
  type ConvertRequest,
  type Engine,
  type FormatSupport,
} from '@conbert/core';
import { convertSubtitles } from '@conbert/core/subtitles';

/** SRT, WebVTT and ASS on the server – the same code as in the browser. */
async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'subtitles need a file path and workDir');
  }
  const to = normalizeExt(req.outputExt);
  await mkdir(req.workDir, { recursive: true });
  const output = path.join(req.workDir, `${randomUUID()}.${to}`);
  const result = convertSubtitles(
    new Uint8Array(await readFile(req.input)),
    req.inputExt,
    to,
    req.options,
  );
  await writeFile(output, result);
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export function subtitleFormats(): FormatSupport[] {
  const all = [...new Set([...SUBTITLE_READ, ...SUBTITLE_WRITE])];
  return all.map((ext) => ({
    ext,
    mime: getFormat(ext)?.mime ?? '',
    canRead: SUBTITLE_READ.includes(ext),
    canWrite: SUBTITLE_WRITE.includes(ext),
  }));
}

export const subtitlesServerEngine: Engine = {
  id: 'subtitles',
  name: 'Untertitel',
  descriptionKey: 'engines.subtitles.description',
  category: 'document',
  runtime: 'server',
  formats: subtitleFormats(),
  options: SUBTITLE_OPTIONS,
  supportsCompression: false,
  // Above pandoc & co.: they don't know subtitle times.
  priority: 20,
  init: () => Promise.resolve(),
  status: () => 'ready',
  convert,
};
