import { IMAGE_OPTIONS, type Engine, type FormatSupport } from '@conbert/core';

/**
 * ImageMagick in the browser (magick-wasm 0.0.45, ImageMagick 7.1.2).
 * Formats checked against the real build. Single-threaded, so it also works
 * on plain-HTTP LAN addresses where libvips can't run.
 */
const READ_WRITE = ['png', 'jpg', 'webp', 'gif', 'tiff', 'avif', 'jxl', 'bmp', 'ico', 'tga', 'jp2'];
const READ_ONLY = ['psd', 'heic'];

export const MAGICK_FORMATS: FormatSupport[] = [
  ...READ_WRITE.map((ext) => ({ ext, canRead: true, canWrite: true })),
  ...READ_ONLY.map((ext) => ({ ext, canRead: true, canWrite: false })),
];

export const MAGICK_META = {
  id: 'magick-wasm',
  name: 'ImageMagick (Browser)',
  descriptionKey: 'engines.magickWasm.description',
  category: 'image',
  runtime: 'browser',
  formats: MAGICK_FORMATS,
  options: IMAGE_OPTIONS,
  supportsCompression: true,
  // Below libvips (20): libvips is faster for the common formats.
  priority: 15,
} as const satisfies Omit<Engine, 'init' | 'status' | 'convert'>;
