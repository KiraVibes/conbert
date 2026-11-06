import { MEDIABUNNY_META } from './mediabunny-definition';
import { createWorkerEngine } from './worker-engine';

/**
 * mediabunny in the browser: video and audio with the browser's own codecs
 * (WebCodecs). Small (~200 KB plus the MP3 encoder) and fast; falls back to
 * ffmpeg.wasm when the browser can't encode something.
 */
export const mediabunnyEngine = createWorkerEngine({
  meta: MEDIABUNNY_META,
  needsIsolation: false,
  createWorker: () =>
    new Worker(new URL('../workers/mediabunny.worker.ts', import.meta.url), {
      type: 'module',
      name: 'mediabunny',
    }),
});
