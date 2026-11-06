// Copies the WASM files of browser engines into public/wasm so Conbert serves
// them itself – no CDN at runtime. Runs before `vite` and `vite build`.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const publicWasm = path.resolve(here, '../public/wasm');

const WASM_ONLY = /\.wasm$/;
const CORE_FILES = /^ffmpeg-core\.(js|wasm)$/;
const ANY = /^[^.]/;
const SOURCES = [
  { probe: 'wasm-vips/vips.wasm', dir: 'wasm-vips', match: WASM_ONLY },
  { probe: '@imagemagick/magick-wasm/magick.wasm', dir: 'magick', match: WASM_ONLY },
  // ffmpeg.wasm single-threaded core (the multi-threaded one hangs on video).
  { probe: '@ffmpeg/core/wasm', dir: 'ffmpeg', match: CORE_FILES },
  // pandoc-wasm exports no subpaths, so its folder is located directly (see below).
  { packageDir: 'pandoc-wasm/src', dir: 'pandoc', match: WASM_ONLY },
  // pdf.js: character maps, the 14 standard fonts and image decoders for previews.
  { packageDir: 'pdfjs-dist/cmaps', dir: 'pdfjs/cmaps', match: ANY },
  { packageDir: 'pdfjs-dist/standard_fonts', dir: 'pdfjs/standard_fonts', match: ANY },
  { packageDir: 'pdfjs-dist/wasm', dir: 'pdfjs/wasm', match: ANY },
  // Draco decoder for compressed 3D models (three.js DRACOLoader).
  {
    packageDir: 'three/examples/jsm/libs/draco',
    dir: 'draco',
    match: /^draco_(decoder\.(js|wasm)|wasm_wrapper\.js)$/,
  },
  // libarchive.js: its worker and libarchive compiled to WebAssembly.
  {
    packageDir: 'libarchive.js/dist',
    dir: 'libarchive',
    match: /^(worker-bundle\.js|libarchive\.wasm)$/,
  },
  // ExifTool (metadata) runs on zeroperl, Perl compiled to WebAssembly. zeroperl
  // is a dependency of @uswriting/exiftool, so it is found from there.
  {
    resolveDir: () =>
      path
        .dirname(
          createRequire(require.resolve('@uswriting/exiftool')).resolve('@6over3/zeroperl-ts'),
        )
        .replace(/([\\/])cjs$/, '$1esm'),
    dir: 'exiftool',
    match: /^zeroperl\.wasm$/,
  },
];

for (const { probe, packageDir, resolveDir, dir, match } of SOURCES) {
  // ffmpeg.wasm loads its core as an ES module, so always take the esm build.
  const sourceDir = resolveDir
    ? resolveDir()
    : packageDir
      ? path.resolve(here, '../node_modules', packageDir)
      : path.dirname(require.resolve(probe)).replace(/([\\/])umd$/, '$1esm');
  const targetDir = path.join(publicWasm, dir);
  mkdirSync(targetDir, { recursive: true });
  const files = readdirSync(sourceDir).filter((f) => match.test(f));
  for (const file of files) copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
  console.warn(`copy-wasm: ${files.length} file(s) → public/wasm/${dir}`);
}
