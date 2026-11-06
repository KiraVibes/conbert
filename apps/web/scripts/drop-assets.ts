import type { Plugin } from 'vite';

/**
 * Removes emitted files nothing loads. wasm-vips points at its WASM with
 * `new URL('vips.wasm', import.meta.url)`, so Vite copies it (~5 MB) into
 * assets/ – but Conbert loads the self-hosted copy from /wasm/ (locateFile).
 */
export function dropAssets(pattern: RegExp): Plugin {
  return {
    name: 'conbert-drop-assets',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        // Rollup's way to drop an emitted file is to remove it from the bundle object.
        if (pattern.test(name)) Reflect.deleteProperty(bundle, name);
      }
    },
  };
}
