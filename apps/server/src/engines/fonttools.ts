import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  FONT_OPTIONS,
  FONT_SUBSET_UNICODES,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  resolveFontSubset,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import { ProcessError, runProcess } from '../lib/run-process';

/**
 * fonttools (Python): TTF/OTF ↔ WOFF/WOFF2 and subsetting. The outlines stay
 * as they are – a CFF font saved as .ttf is still a valid OpenType font that
 * every system installs.
 */
const PYTHON = process.env['CONBERT_PYTHON_PATH'] ?? 'python3';
const TIMEOUT_MS = 2 * 60 * 1000;
const FORMATS = ['ttf', 'otf', 'woff', 'woff2'];

/** argv: input, output, flavor ("" = plain), unicodes ("" = all). */
const SCRIPT = `
import sys
from fontTools.ttLib import TTFont
from fontTools import subset
src, dst, flavor, unicodes = sys.argv[1:5]
font = TTFont(src)
if unicodes:
    options = subset.Options()
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.notdef_outline = True
    options.glyph_names = True
    sub = subset.Subsetter(options)
    sub.populate(unicodes=subset.parse_unicodes(unicodes))
    sub.subset(font)
font.flavor = flavor or None
font.save(dst)
`;

let status: EngineStatus = 'uninitialized';

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'fonttools needs a file path and workDir');
  }
  const to = normalizeExt(req.outputExt);
  await mkdir(req.workDir, { recursive: true });
  const output = path.join(req.workDir, `${randomUUID()}.${to}`);
  const subsetChoice = resolveFontSubset(req.options);
  const unicodes = subsetChoice === 'all' ? '' : FONT_SUBSET_UNICODES[subsetChoice];
  const flavor = to === 'woff' || to === 'woff2' ? to : '';
  req.onProgress?.({ percent: 10, stage: 'converting' });
  try {
    await runProcess(PYTHON, ['-I', '-c', SCRIPT, req.input, output, flavor, unicodes], {
      timeoutMs: TIMEOUT_MS,
      signal: req.signal,
    });
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    const details =
      error instanceof ProcessError
        ? error.result.stderr.trim().slice(-2000) || error.message
        : String(error);
    throw new ConversionError('errors.convertFailed', details);
  }
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const fonttoolsEngine: Engine = {
  id: 'fonttools',
  name: 'fonttools',
  descriptionKey: 'engines.fonttools.description',
  category: 'font',
  runtime: 'server',
  formats: FORMATS.map((ext) => ({
    ext,
    mime: getFormat(ext)?.mime ?? '',
    canRead: true,
    canWrite: true,
  })),
  options: FONT_OPTIONS,
  supportsCompression: true,
  priority: 10,
  async init() {
    try {
      await runProcess(PYTHON, ['-I', '-c', 'import fontTools, brotli'], { timeoutMs: 20_000 });
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
