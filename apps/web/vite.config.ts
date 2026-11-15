import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { dropAssets } from './scripts/drop-assets.ts';
import { offlineManifest } from './scripts/offline-manifest.ts';
import { precompress } from './scripts/precompress.ts';

/**
 * Cross-origin isolation (COOP/COEP) is required for SharedArrayBuffer, which
 * the multi-threaded WASM engines (wasm-vips, ffmpeg.wasm) need. The Fastify
 * server sends the same headers in production.
 */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** wasm-vips' own copy of its WASM – Conbert loads the one in /wasm/. */
const UNUSED_ASSETS = /^assets\/vips-[\w-]+\.wasm$/;

const apiTarget = `http://localhost:${process.env['CONBERT_PORT'] ?? '3313'}`;

export default defineConfig({
  plugins: [react(), tailwindcss(), dropAssets(UNUSED_ASSETS), offlineManifest(), precompress()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // pandoc-wasm exports only an entry that fetches the 58 MB WASM itself;
      // Conbert loads the self-hosted copy and only needs the core.
      'pandoc-wasm/core': path.resolve(import.meta.dirname, 'node_modules/pandoc-wasm/src/core.js'),
    },
  },
  server: {
    port: Number(process.env['CONBERT_WEB_PORT'] ?? 3314),
    strictPort: true,
    headers: isolationHeaders,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false, ws: true },
    },
  },
  preview: {
    port: 3315,
    strictPort: true,
    headers: isolationHeaders,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false, ws: true },
    },
  },
  // wasm-vips spawns its own pthread workers relative to its script, so it
  // must not be pre-bundled.
  optimizeDeps: {
    // These spawn their own workers relative to their script files.
    exclude: ['wasm-vips', '@ffmpeg/ffmpeg', '@ffmpeg/util'],
    // Pre-bundle what the workers import, so Vite doesn't reload mid-session.
    include: [
      'comlink',
      '@imagemagick/magick-wasm',
      'mediabunny',
      '@mediabunny/mp3-encoder',
      'spessasynth_core',
      'pandoc-wasm/core',
      'three',
      '@gltf-transform/core',
      '@gltf-transform/extensions',
      '@gltf-transform/functions',
      'meshoptimizer',
      'yaml',
      'smol-toml',
      'fast-xml-parser',
      'papaparse',
      'read-excel-file/universal',
      'write-excel-file/universal',
      'libarchive.js',
      '@uswriting/exiftool',
      'music-metadata',
      'svgo/browser',
    ],
  },
  worker: { format: 'es', plugins: () => [dropAssets(UNUSED_ASSETS)] },
  build: { target: 'es2022' },
});
