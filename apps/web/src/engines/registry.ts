import type { Engine } from '@conbert/core';
import { archivesBrowserEngine } from './archives-browser';
import { dataBrowserEngine } from './data-browser';
import { subtitlesBrowserEngine } from './subtitles-browser';
import { svgoBrowserEngine } from './svgo-browser';
import { libvipsEngine } from './libvips';
import { ffmpegWasmEngine } from './ffmpeg-wasm';
import { magickEngine } from './magick';
import { mediabunnyEngine } from './mediabunny';
import { pandocWasmEngine } from './pandoc-wasm';
import { pdfjsRenderEngine } from './pdfjs-render';
import { gltfTransformBrowserEngine, three3dEngine } from './three-3d';
import { spessasynthMidiEngine, spessasynthSoundfontEngine } from './spessasynth';

/**
 * All browser engines (WASM, each running in its own Web Worker).
 * Engines are lazy: nothing is downloaded until the first conversion.
 */
export const browserEngines: readonly Engine[] = [
  libvipsEngine,
  magickEngine,
  mediabunnyEngine,
  ffmpegWasmEngine,
  spessasynthMidiEngine,
  spessasynthSoundfontEngine,
  pandocWasmEngine,
  three3dEngine,
  gltfTransformBrowserEngine,
  dataBrowserEngine,
  subtitlesBrowserEngine,
  archivesBrowserEngine,
  pdfjsRenderEngine,
  svgoBrowserEngine,
];

export function getBrowserEngine(id: string): Engine | undefined {
  return browserEngines.find((e) => e.id === id);
}
