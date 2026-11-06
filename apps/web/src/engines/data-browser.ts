import { DATA_OPTIONS } from '@conbert/core';
import { createWorkerEngine } from './worker-engine';

/** Formats of @conbert/core/data – kept here so the main bundle doesn't load the parsers. */
const DATA_FORMATS = ['json', 'yaml', 'toml', 'xml', 'csv', 'xlsx'];

/** JSON, YAML, TOML, XML, CSV and Excel in the browser (same code as the server). */
export const dataBrowserEngine = createWorkerEngine({
  meta: {
    id: 'data-formats-wasm',
    name: 'Datenformate (Browser)',
    descriptionKey: 'engines.dataFormats.description',
    category: 'data',
    runtime: 'browser',
    formats: DATA_FORMATS.map((ext) => ({ ext, canRead: true, canWrite: true })),
    options: DATA_OPTIONS,
    supportsCompression: false,
    priority: 20,
  },
  needsIsolation: false,
  createWorker: () =>
    new Worker(new URL('../workers/data.worker.ts', import.meta.url), {
      type: 'module',
      name: 'data',
    }),
});
