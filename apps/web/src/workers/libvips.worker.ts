import Vips from 'wasm-vips';
import { ConversionError, normalizeExt } from '@conbert/core';
import { convertWithVips, type VipsModule } from '@/engines/libvips-convert';
import { MODULE_FORMATS } from '@/engines/libvips-definition';
import { exposeEngine } from './expose-engine';

/** WASM files are served by Conbert itself (copied by scripts/copy-wasm.mjs). */
const WASM_BASE = '/wasm/wasm-vips/';

let vips: VipsModule | null = null;
let unavailableFormats: string[] = [];

function load(modules: string[]): Promise<VipsModule> {
  return Vips({
    locateFile: (file: string) => WASM_BASE + file,
    dynamicLibraries: modules,
  });
}

exposeEngine({
  async init() {
    if (vips) return { unavailableFormats };
    const modules = [...new Set(Object.values(MODULE_FORMATS))];
    try {
      vips = await load(modules);
    } catch (error) {
      // The base engine still works without the optional modules
      // (AVIF, JPEG XL, SVG) – report "partially ready" instead of failing.
      console.warn('wasm-vips: optional modules failed to load', error);
      vips = await load([]);
      unavailableFormats = Object.keys(MODULE_FORMATS);
    }
    return { unavailableFormats };
  },
  convert(input, inputExt, outputExt, options) {
    if (!vips) throw new ConversionError('errors.engineLoadFailed', 'engine not initialised');
    const blocked = [normalizeExt(inputExt), normalizeExt(outputExt)].find((ext) =>
      unavailableFormats.includes(ext),
    );
    if (blocked) throw new ConversionError('errors.formatUnavailable', `module for .${blocked}`);
    return convertWithVips(vips, input, inputExt, outputExt, options);
  },
});
