import { DOCUMENT_OPTIONS, PANDOC_READERS, PANDOC_WRITERS } from '@conbert/core';
import { createWorkerEngine } from './worker-engine';

const READ = Object.keys(PANDOC_READERS);
const WRITE = Object.keys(PANDOC_WRITERS);

/**
 * pandoc in the browser (pandoc-wasm 1.1.0 = pandoc 3.10). Same formats and
 * options as the server's native pandoc. The WASM is large (~58 MB), so it is
 * loaded on first use only; the browser caches it afterwards.
 */
export const pandocWasmEngine = createWorkerEngine({
  meta: {
    id: 'pandoc-wasm',
    name: 'Pandoc (Browser)',
    descriptionKey: 'engines.pandocWasm.description',
    category: 'document',
    runtime: 'browser',
    formats: [...new Set([...READ, ...WRITE])].map((ext) => ({
      ext,
      canRead: READ.includes(ext),
      canWrite: WRITE.includes(ext),
    })),
    options: DOCUMENT_OPTIONS,
    supportsCompression: false,
    priority: 10,
  },
  needsIsolation: false,
  createWorker: () =>
    new Worker(new URL('../workers/pandoc.worker.ts', import.meta.url), {
      type: 'module',
      name: 'pandoc',
    }),
});
