import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { optimize } from 'svgo';
import {
  ConversionError,
  SVG_OPTIONS,
  abortError,
  svgoConfig,
  type ConvertRequest,
  type Engine,
} from '@conbert/core';

/** SVGs made smaller with svgo – the same settings as in the browser. */
async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'svgo needs a file path and workDir');
  }
  await mkdir(req.workDir, { recursive: true });
  const output = path.join(req.workDir, `${randomUUID()}.svg`);
  let result: string;
  try {
    result = optimize(await readFile(req.input, 'utf8'), svgoConfig(req.options)).data;
  } catch (error) {
    throw new ConversionError(
      'errors.convertFailed',
      error instanceof Error ? error.message : String(error),
    );
  }
  await writeFile(output, result);
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const svgoEngine: Engine = {
  id: 'svgo',
  name: 'svgo',
  descriptionKey: 'engines.svgo.description',
  category: 'vector',
  runtime: 'server',
  formats: [{ ext: 'svg', mime: 'image/svg+xml', canRead: true, canWrite: true }],
  options: SVG_OPTIONS,
  supportsCompression: true,
  // Above ImageMagick & co.: they would turn the SVG into a picture inside an SVG.
  priority: 30,
  init: () => Promise.resolve(),
  status: () => 'ready',
  convert,
};
