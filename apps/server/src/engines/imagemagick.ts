import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  IMAGE_OPTIONS,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  resolveImageOptions,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
  type FormatSupport,
} from '@conbert/core';
import { ProcessError, runProcess } from '../lib/run-process';

/**
 * ImageMagick 7 (`magick` CLI) for formats sharp doesn't know. Only these
 * coders are ever used – each also has to be allowed in policy.xml.
 */
interface Candidate {
  ext: string;
  coder: string;
  write: boolean;
}

const CANDIDATES: readonly Candidate[] = [
  { ext: 'jpg', coder: 'JPEG', write: true },
  { ext: 'png', coder: 'PNG', write: true },
  { ext: 'webp', coder: 'WEBP', write: true },
  { ext: 'gif', coder: 'GIF', write: true },
  { ext: 'tiff', coder: 'TIFF', write: true },
  { ext: 'bmp', coder: 'BMP', write: true },
  { ext: 'ico', coder: 'ICO', write: true },
  { ext: 'tga', coder: 'TGA', write: true },
  { ext: 'jp2', coder: 'JP2', write: true },
  { ext: 'psd', coder: 'PSD', write: false },
  { ext: 'heic', coder: 'HEIC', write: false },
];

const MAGICK = process.env['CONBERT_MAGICK_PATH'] ?? 'magick';
const TIMEOUT_MS = 120_000;
/** Resource limits per call, on top of policy.xml. */
const LIMITS = ['-limit', 'memory', '512MiB', '-limit', 'map', '1GiB', '-limit', 'disk', '2GiB'];
const TIFF_COMPRESSION = { deflate: 'Zip', lzw: 'LZW', jpeg: 'JPEG', none: 'None' } as const;
const LOSSY = new Set(['jpg', 'webp', 'jp2']);
const ANIMATED = new Set(['gif', 'webp']);

let status: EngineStatus = 'uninitialized';
let available: Candidate[] = [];

/**
 * Parses `magick -list format`, e.g. "      BMP* BMP       rw-   Microsoft …".
 * Returns coder → mode ("rw+", "r--" …).
 */
export function parseFormatList(output: string): Map<string, string> {
  const modes = new Map<string, string>();
  for (const line of output.split('\n')) {
    const match = /^\s*([A-Z0-9-]+)\*?\s+\S+\s+([r-][w-][+-])\s/.exec(line);
    if (match?.[1] && match[2]) modes.set(match[1], match[2]);
  }
  return modes;
}

function coderOf(ext: string): Candidate | undefined {
  return available.find((c) => c.ext === ext);
}

/** Builds the magick arguments for one conversion (exported for tests). */
export function buildArgs(
  input: string,
  inputExt: string,
  output: string,
  outputExt: string,
  rawOptions: Record<string, unknown>,
  coders: { input: string; output: string },
): string[] {
  const o = resolveImageOptions(rawOptions);
  const target = getFormat(outputExt);
  const animated = o.keepAnimation && ANIMATED.has(inputExt) && !!target?.supportsAnimation;
  // Explicit coder prefixes: ImageMagick must never guess the type from the
  // content. "[0]" takes the first frame / the flattened PSD composite.
  const args = [...LIMITS, `${coders.input}:${input}${animated ? '' : '[0]'}`, '-auto-orient'];
  if (target?.supportsTransparency === false) {
    args.push('-background', 'white', '-alpha', 'remove', '-alpha', 'off');
  }
  // Remove all metadata except the color profile.
  if (o.stripMetadata) args.push('+profile', '!icc,*');
  if (outputExt === 'ico') args.push('-resize', '256x256>');
  // Compressing to a size: fewer pixels.
  else if (o.scalePercent < 100) args.push('-resize', `${o.scalePercent}%`);
  if (LOSSY.has(outputExt) && !o.lossless) args.push('-quality', String(o.quality));
  if (outputExt === 'webp' && o.lossless) args.push('-define', 'webp:lossless=true');
  if (outputExt === 'tiff') {
    args.push('-compress', TIFF_COMPRESSION[o.tiffCompression]);
    if (o.tiffCompression === 'jpeg') args.push('-quality', String(o.quality));
  }
  const outCoder = outputExt === 'png' && o.pngPalette ? 'PNG8' : coders.output;
  args.push(`${outCoder}:${output}`);
  return args;
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'ImageMagick needs a file path and workDir');
  }
  const from = normalizeExt(req.inputExt);
  const to = normalizeExt(req.outputExt);
  const inCoder = coderOf(from);
  const outCoder = coderOf(to);
  if (!inCoder || !outCoder?.write) {
    throw new ConversionError('errors.formatUnavailable', `ImageMagick: .${from} → .${to}`);
  }
  await mkdir(req.workDir, { recursive: true });
  const output = path.join(req.workDir, `${randomUUID()}.${to}`);
  const args = buildArgs(req.input, from, output, to, req.options, {
    input: inCoder.coder,
    output: outCoder.coder,
  });

  req.onProgress?.({ percent: 10, stage: 'converting' });
  try {
    await runProcess(MAGICK, args, { timeoutMs: TIMEOUT_MS, signal: req.signal });
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    if (error instanceof ProcessError) {
      const details = error.result.stderr.trim() || error.message;
      const key =
        error.reason === 'timeout' || /cache resources exhausted|memory/i.test(details)
          ? 'errors.outOfMemory'
          : 'errors.convertFailed';
      throw new ConversionError(key, details);
    }
    throw new ConversionError('errors.convertFailed', String(error));
  }
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const imagemagickEngine: Engine = {
  id: 'imagemagick',
  name: 'ImageMagick',
  descriptionKey: 'engines.imagemagick.description',
  category: 'image',
  runtime: 'server',
  formats: [],
  options: IMAGE_OPTIONS,
  supportsCompression: true,
  // Below sharp: ImageMagick is used for formats sharp can't handle.
  priority: 10,
  async init() {
    status = 'loading';
    try {
      const { stdout } = await runProcess(MAGICK, ['-list', 'format'], { timeoutMs: 15_000 });
      const modes = parseFormatList(stdout);
      available = CANDIDATES.flatMap((c) => {
        const mode = modes.get(c.coder);
        if (!mode?.startsWith('r')) return [];
        return [{ ...c, write: c.write && mode[1] === 'w' }];
      });
      imagemagickEngine.formats = available.map((c): FormatSupport => ({
        ext: c.ext,
        mime: getFormat(c.ext)?.mime ?? '',
        canRead: true,
        canWrite: c.write,
      }));
      status = available.length > 0 ? 'ready' : 'error';
    } catch {
      // `magick` is not installed (e.g. local development on Windows).
      available = [];
      imagemagickEngine.formats = [];
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
