import { MAGICK_META } from './magick-definition';
import { createWorkerEngine } from './worker-engine';

/**
 * ImageMagick in the browser for formats libvips doesn't know (BMP, ICO, TGA,
 * JPEG 2000, PSD, HEIC). ~15 MB WASM, loaded on first use. Single-threaded,
 * so it works without cross-origin isolation too.
 */
export const magickEngine = createWorkerEngine({
  meta: MAGICK_META,
  needsIsolation: false,
  createWorker: () =>
    new Worker(new URL('../workers/magick.worker.ts', import.meta.url), {
      type: 'module',
      name: 'imagemagick',
    }),
});
