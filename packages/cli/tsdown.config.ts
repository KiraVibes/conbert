import { defineConfig } from 'tsdown';

/** One file without dependencies: the server offers it at /cli/conbert.mjs. */
export default defineConfig({
  entry: { conbert: 'src/main.ts' },
  format: 'esm',
  platform: 'node',
  // Users run it with whatever Node they have; 20 has fetch and openAsBlob.
  target: 'node20',
  outDir: 'dist',
  clean: true,
  outExtensions: () => ({ js: '.mjs' }),
  banner: { js: '#!/usr/bin/env node' },
});
