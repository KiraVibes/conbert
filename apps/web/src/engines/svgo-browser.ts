import { SVG_OPTIONS } from '@conbert/core';
import { createWorkerEngine } from './worker-engine';

/** svgo in the browser: SVGs made smaller (same format). */
export const svgoBrowserEngine = createWorkerEngine({
  meta: {
    id: 'svgo-browser',
    name: 'svgo (Browser)',
    descriptionKey: 'engines.svgo.description',
    category: 'vector',
    runtime: 'browser',
    formats: [{ ext: 'svg', mime: 'image/svg+xml', canRead: true, canWrite: true }],
    options: SVG_OPTIONS,
    supportsCompression: true,
    // Above ImageMagick & co.: they would turn the SVG into a picture inside an SVG.
    priority: 30,
  },
  needsIsolation: false,
  createWorker: () =>
    new Worker(new URL('../workers/svgo.worker.ts', import.meta.url), {
      type: 'module',
      name: 'svgo',
    }),
});
