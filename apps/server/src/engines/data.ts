import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  DATA_OPTIONS,
  abortError,
  getFormat,
  normalizeExt,
  type ConvertRequest,
  type Engine,
} from '@conbert/core';
import { DATA_FORMATS, convertData } from '@conbert/core/data';

/** Data formats on the server – the same code as in the browser. */
async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'data needs a file path and workDir');
  }
  const to = normalizeExt(req.outputExt);
  await mkdir(req.workDir, { recursive: true });
  const output = path.join(req.workDir, `${randomUUID()}.${to}`);
  const result = await convertData(
    new Uint8Array(await readFile(req.input)),
    normalizeExt(req.inputExt),
    to,
    req.options,
  );
  await writeFile(output, result);
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const dataServerEngine: Engine = {
  id: 'data-formats',
  name: 'Datenformate',
  descriptionKey: 'engines.dataFormats.description',
  category: 'data',
  runtime: 'server',
  formats: DATA_FORMATS.map((ext) => ({
    ext,
    mime: getFormat(ext)?.mime ?? '',
    canRead: true,
    canWrite: true,
  })),
  options: DATA_OPTIONS,
  supportsCompression: false,
  // Above LibreOffice (15) for CSV ↔ XLSX: keeps numbers and text as they are.
  priority: 20,
  init: () => Promise.resolve(),
  status: () => 'ready',
  convert,
};
