import { createPandocInstance, type PandocInstance } from 'pandoc-wasm/core';
import { convertWithPandocWasm } from '@/engines/pandoc-wasm-convert';
import { exposeEngine } from './expose-engine';

/** Served by Conbert itself (copied by scripts/copy-wasm.mjs). ~58 MB. */
const WASM_URL = '/wasm/pandoc/pandoc.wasm';

let pandoc: PandocInstance | null = null;

exposeEngine({
  async init() {
    if (!pandoc) {
      const response = await fetch(new URL(WASM_URL, self.location.origin));
      if (!response.ok) throw new Error(`pandoc.wasm: HTTP ${response.status}`);
      pandoc = await createPandocInstance(await response.arrayBuffer());
    }
    return { unavailableFormats: [] };
  },
  async convert(input, inputExt, outputExt, options, onProgress) {
    if (!pandoc) throw new Error('pandoc-wasm is not initialised');
    return convertWithPandocWasm(pandoc, input, inputExt, outputExt, options, onProgress);
  },
});
