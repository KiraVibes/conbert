import * as Magick from '@imagemagick/magick-wasm';
import { convertWithMagick } from '@/engines/magick-convert';
import { exposeEngine } from './expose-engine';

/** Served by Conbert itself (copied by scripts/copy-wasm.mjs). */
const WASM_URL = '/wasm/magick/magick.wasm';

let ready = false;

exposeEngine({
  async init() {
    if (!ready) {
      await Magick.initializeImageMagick(new URL(WASM_URL, self.location.origin));
      ready = true;
    }
    return { unavailableFormats: [] };
  },
  convert(input, inputExt, outputExt, options) {
    return convertWithMagick(Magick, input, inputExt, outputExt, options);
  },
});
