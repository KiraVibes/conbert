import { SUBTITLE_OPTIONS, SUBTITLE_READ, SUBTITLE_WRITE } from '@conbert/core';
import { createWorkerEngine } from './worker-engine';

const FORMATS = [...new Set([...SUBTITLE_READ, ...SUBTITLE_WRITE])];

/** SRT, WebVTT and ASS in the browser (same code as the server). */
export const subtitlesBrowserEngine = createWorkerEngine({
  meta: {
    id: 'subtitles-browser',
    name: 'Untertitel (Browser)',
    descriptionKey: 'engines.subtitles.description',
    category: 'document',
    runtime: 'browser',
    formats: FORMATS.map((ext) => ({
      ext,
      canRead: SUBTITLE_READ.includes(ext),
      canWrite: SUBTITLE_WRITE.includes(ext),
    })),
    options: SUBTITLE_OPTIONS,
    supportsCompression: false,
    priority: 20,
  },
  needsIsolation: false,
  createWorker: () =>
    new Worker(new URL('../workers/subtitles.worker.ts', import.meta.url), {
      type: 'module',
      name: 'subtitles',
    }),
});
