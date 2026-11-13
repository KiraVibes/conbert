import type * as Magick from '@imagemagick/magick-wasm';
import {
  ConversionError,
  getFormat,
  normalizeExt,
  resolveImageOptions,
  type ImageOptions,
} from '@conbert/core';

/** The loaded magick-wasm module (exports). */
export type MagickApi = typeof Magick;

const FORMAT_KEY = {
  png: 'Png',
  jpg: 'Jpeg',
  webp: 'WebP',
  gif: 'Gif',
  tiff: 'Tiff',
  avif: 'Avif',
  jxl: 'Jxl',
  bmp: 'Bmp',
  ico: 'Ico',
  tga: 'Tga',
  jp2: 'Jp2',
  psd: 'Psd',
  heic: 'Heic',
} as const;

const LOSSY = new Set(['jpg', 'webp', 'avif', 'jxl', 'jp2']);
const ANIMATED = new Set(['gif', 'webp']);

function format(api: MagickApi, ext: string): Magick.MagickFormat {
  const key = FORMAT_KEY[ext as keyof typeof FORMAT_KEY];
  if (!key) throw new ConversionError('errors.formatUnavailable', `ImageMagick (browser): .${ext}`);
  return api.MagickFormat[key];
}

function prepare(api: MagickApi, image: Magick.IMagickImage, to: string, o: ImageOptions): void {
  const target = getFormat(to);
  image.autoOrient();
  if (target?.supportsTransparency === false && image.hasAlpha) {
    image.backgroundColor = new api.MagickColor('white');
    image.alpha(api.AlphaAction.Remove);
  }
  if (o.stripMetadata) image.strip();
  if (to === 'ico' && (image.width > 256 || image.height > 256)) {
    // Icons can be at most 256 × 256 pixels.
    image.resize(new api.MagickGeometry('256x256>'));
  } else if (o.scalePercent < 100) {
    // Compressing to a size: fewer pixels.
    image.resize(new api.MagickGeometry(`${o.scalePercent}%`));
  }
  if (LOSSY.has(to)) image.quality = o.lossless ? 100 : o.quality;
  if (to === 'webp' && o.lossless)
    image.settings.setDefine(api.MagickFormat.WebP, 'lossless', true);
  if (to === 'tiff') {
    image.setCompression(
      {
        deflate: api.CompressionMethod.Zip,
        lzw: api.CompressionMethod.LZW,
        jpeg: api.CompressionMethod.JPEG,
        none: api.CompressionMethod.NoCompression,
      }[o.tiffCompression],
    );
  }
}

/**
 * Converts one image with an initialised magick-wasm. Every input is read
 * with an explicit format, so ImageMagick never guesses from the content
 * (no MVG/MSL tricks). Pure function: runs in the worker and in Node tests.
 */
export function convertWithMagick(
  api: MagickApi,
  input: Uint8Array,
  inputExt: string,
  outputExt: string,
  rawOptions: Record<string, unknown>,
): Uint8Array {
  const from = normalizeExt(inputExt);
  const to = normalizeExt(outputExt);
  const o = resolveImageOptions(rawOptions);
  const inFormat = format(api, from);
  const outFormat = to === 'png' && o.pngPalette ? api.MagickFormat.Png8 : format(api, to);
  const animated = o.keepAnimation && ANIMATED.has(from) && getFormat(to)?.supportsAnimation;

  try {
    if (animated) {
      return api.ImageMagick.readCollection(input, inFormat, (images) => {
        images.coalesce();
        for (const image of images) prepare(api, image, to, o);
        // The buffer is only valid inside the callback – copy it out.
        return images.write(outFormat, (data) => data.slice());
      });
    }
    return api.ImageMagick.read(input, inFormat, (image) => {
      prepare(api, image, to, o);
      return image.write(outFormat, (data) => data.slice());
    });
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/memory|cache resources exhausted/i.test(message)) {
      throw new ConversionError('errors.outOfMemory', message);
    }
    throw new ConversionError('errors.convertFailed', message);
  }
}
