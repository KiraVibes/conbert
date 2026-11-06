import { LIBVIPS_META } from './libvips-definition';
import { createWorkerEngine } from './worker-engine';

/**
 * libvips in the browser (wasm-vips). Runs in its own Web Worker; the WASM
 * files (~12 MB incl. AVIF/JPEG XL/SVG modules) load on first use only.
 * Uses threads, so it needs a cross-origin isolated page (HTTPS/localhost).
 */
export const libvipsEngine = createWorkerEngine({
  meta: LIBVIPS_META,
  needsIsolation: true,
  createWorker: () =>
    new Worker(new URL('../workers/libvips.worker.ts', import.meta.url), {
      type: 'module',
      name: 'libvips',
    }),
});
