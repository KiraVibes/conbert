import type Vips from 'wasm-vips';
import {
  ConversionError,
  IMAGE_EFFORT,
  getFormat,
  normalizeExt,
  resolveImageOptions,
  type ImageOptions,
} from '@conbert/core';

/** The initialised wasm-vips module. */
export type VipsModule = Awaited<ReturnType<typeof Vips>>;

/** Saver suffix per canonical extension. */
const SUFFIX: Record<string, string> = {
  jpg: '.jpg',
  png: '.png',
  webp: '.webp',
  gif: '.gif',
  tiff: '.tif',
  avif: '.avif',
  jxl: '.jxl',
};

/** Builds the libvips save options for one target format. */
export function saveOptions(outputExt: string, o: ImageOptions): Record<string, unknown> {
  // Keeping only the ICC profile removes EXIF (incl. GPS position), XMP and
  // IPTC while colors stay correct.
  const keep = o.stripMetadata ? 'icc' : 'all';
  const effort = IMAGE_EFFORT[outputExt]?.[o.effort];
  switch (outputExt) {
    case 'jpg':
      return { Q: o.quality, keep, optimize_coding: true, interlace: true };
    case 'webp':
      return { Q: o.quality, lossless: o.lossless, effort, keep };
    case 'avif':
      return { Q: o.quality, lossless: o.lossless, effort, keep, compression: 'av1' };
    case 'jxl':
      return { Q: o.quality, lossless: o.lossless, effort, keep };
    case 'png':
      return { compression: 6, palette: o.pngPalette, effort, keep };
    case 'gif':
      return { effort, keep };
    case 'tiff':
      return o.tiffCompression === 'jpeg'
        ? { compression: 'jpeg', Q: o.quality, keep }
        : { compression: o.tiffCompression, keep };
    default:
      return { keep };
  }
}

const ANIMATED_INPUTS = new Set(['gif', 'webp']);
const MEMORY_HINTS = /out of memory|memory access out of bounds|Cannot enlarge memory|RangeError/i;

/**
 * Converts one image with an initialised wasm-vips instance. Pure function:
 * runs in the Web Worker in the browser and directly in Node for tests.
 */
export function convertWithVips(
  vips: VipsModule,
  input: Uint8Array,
  inputExt: string,
  outputExt: string,
  rawOptions: Record<string, unknown>,
): Uint8Array {
  const from = normalizeExt(inputExt);
  const to = normalizeExt(outputExt);
  const suffix = SUFFIX[to];
  if (!suffix) throw new ConversionError('errors.formatUnavailable', `libvips cannot write .${to}`);
  const options = resolveImageOptions(rawOptions);
  const target = getFormat(to);
  const animated =
    options.keepAnimation && ANIMATED_INPUTS.has(from) && !!target?.supportsAnimation;

  // Every intermediate image owns WASM memory and must be freed explicitly.
  const handles: { delete(): void }[] = [];
  const track = <T extends { delete(): void }>(image: T): T => {
    handles.push(image);
    return image;
  };

  try {
    let image = track(vips.Image.newFromBuffer(input, animated ? '[n=-1]' : ''));

    // Apply the EXIF orientation before the metadata is stripped, otherwise
    // phone photos would end up sideways.
    if (!animated) image = track(image.autorot());

    // Compressing to a size: fewer pixels (still pictures only).
    if (!animated && options.scalePercent < 100) {
      image = track(image.resize(options.scalePercent / 100));
    }

    // CMYK or Lab images (print files) need converting for screen formats.
    if (image.interpretation === 'cmyk' || image.interpretation === 'lab') {
      image = track(image.colourspace('srgb'));
    }

    // Formats without transparency: transparent areas become white.
    if (target?.supportsTransparency === false && image.hasAlpha()) {
      image = track(image.flatten({ background: [255, 255, 255] }));
    }

    return image.writeToBuffer(suffix, saveOptions(to, options));
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (MEMORY_HINTS.test(message)) throw new ConversionError('errors.outOfMemory', message);
    throw new ConversionError('errors.convertFailed', message);
  } finally {
    for (const handle of handles.reverse()) {
      try {
        handle.delete();
      } catch {
        // already freed
      }
    }
  }
}
