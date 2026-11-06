import { IMAGE_OPTIONS, type Engine, type FormatSupport } from '@conbert/core';

/**
 * Static description of the libvips browser engine (wasm-vips). Kept free of
 * WASM imports so the UI, router and tests can use it without loading
 * anything.
 */

/** Formats wasm-vips 0.0.19 can read and write (checked against the real build). */
const READ_WRITE = ['png', 'jpg', 'webp', 'gif', 'tiff', 'avif', 'jxl'] as const;
/** Read-only: SVG is rendered with resvg (no scripts, no external resources). */
const READ_ONLY = ['svg'] as const;

export const LIBVIPS_FORMATS: FormatSupport[] = [
  ...READ_WRITE.map((ext) => ({ ext, canRead: true, canWrite: true })),
  ...READ_ONLY.map((ext) => ({ ext, canRead: true, canWrite: false })),
];

/** Formats that need one of the optional wasm-vips modules. */
export const MODULE_FORMATS: Record<string, string> = {
  avif: 'vips-heif.wasm',
  jxl: 'vips-jxl.wasm',
  svg: 'vips-resvg.wasm',
};

export const LIBVIPS_META = {
  id: 'libvips',
  name: 'libvips',
  descriptionKey: 'engines.libvips.description',
  category: 'image',
  runtime: 'browser',
  formats: LIBVIPS_FORMATS,
  options: IMAGE_OPTIONS,
  supportsCompression: true,
  priority: 20,
} as const satisfies Omit<Engine, 'init' | 'status' | 'convert'>;
