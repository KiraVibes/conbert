import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  ConversionError,
  IMAGE_EFFORT,
  IMAGE_OPTIONS,
  abortError,
  getFormat,
  normalizeExt,
  resolveImageOptions,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
  type FormatSupport,
} from '@conbert/core';

/** Formats of the prebuilt sharp/libvips (no JPEG XL, HEIF only as AVIF). */
const READ_WRITE = ['jpg', 'png', 'webp', 'gif', 'tiff', 'avif'] as const;
const READ_ONLY = ['svg'] as const;
const ANIMATED = new Set(['gif', 'webp']);
const TIFF_COMPRESSION = { deflate: 'deflate', lzw: 'lzw', jpeg: 'jpeg', none: 'none' } as const;

const formats: FormatSupport[] = [
  ...READ_WRITE.map((ext) => ({ ext, canRead: true, canWrite: true })),
  ...READ_ONLY.map((ext) => ({ ext, canRead: true, canWrite: false })),
].map((f) => ({ ...f, mime: getFormat(f.ext)?.mime ?? '' }));

// Every file is converted once; libvips' operation cache would only keep
// files open (on Windows that even blocks deleting them).
sharp.cache(false);

let status: EngineStatus = 'uninitialized';

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'sharp needs a file path and workDir');
  }
  const from = normalizeExt(req.inputExt);
  const to = normalizeExt(req.outputExt);
  if (!(READ_WRITE as readonly string[]).includes(to)) {
    throw new ConversionError('errors.formatUnavailable', `sharp cannot write .${to}`);
  }
  const o = resolveImageOptions(req.options);
  const target = getFormat(to);
  const animated = o.keepAnimation && ANIMATED.has(from) && !!target?.supportsAnimation;
  const effort = IMAGE_EFFORT[to]?.[o.effort];
  await mkdir(req.workDir, { recursive: true });
  const output = path.join(req.workDir, `${randomUUID()}.${to}`);

  req.onProgress?.({ percent: 10, stage: 'converting' });
  try {
    let image = sharp(req.input, { animated, failOn: 'error' });
    // Apply the EXIF orientation before metadata is removed.
    if (!animated) image = image.rotate();
    if (target?.supportsTransparency === false) image = image.flatten({ background: '#ffffff' });
    // Keep only the color profile unless all metadata should stay.
    image = o.stripMetadata ? image.keepIccProfile() : image.keepMetadata();

    switch (to) {
      case 'jpg':
        image = image.jpeg({ quality: o.quality, mozjpeg: true, progressive: true });
        break;
      case 'png':
        image = image.png({ compressionLevel: 6, palette: o.pngPalette, effort: effort ?? 7 });
        break;
      case 'webp':
        image = image.webp({ quality: o.quality, lossless: o.lossless, effort: effort ?? 4 });
        break;
      case 'avif':
        image = image.avif({ quality: o.quality, lossless: o.lossless, effort: effort ?? 4 });
        break;
      case 'gif':
        image = image.gif({ effort: effort ?? 7 });
        break;
      case 'tiff':
        image = image.tiff({
          compression: TIFF_COMPRESSION[o.tiffCompression],
          quality: o.quality,
        });
        break;
    }
    await image.toFile(output);
  } catch (error) {
    if (req.signal?.aborted) throw abortError();
    const message = error instanceof Error ? error.message : String(error);
    throw new ConversionError(
      /memory|pixel limit/i.test(message) ? 'errors.outOfMemory' : 'errors.convertFailed',
      message,
    );
  }
  if (req.signal?.aborted) throw abortError();
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const sharpEngine: Engine = {
  id: 'sharp',
  name: 'sharp (libvips)',
  descriptionKey: 'engines.sharp.description',
  category: 'image',
  runtime: 'server',
  formats,
  options: IMAGE_OPTIONS,
  supportsCompression: true,
  priority: 20,
  async init() {
    try {
      // Fails fast if the native module can't be loaded on this system.
      await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
        .png()
        .toBuffer();
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
