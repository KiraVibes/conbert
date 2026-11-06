import { optimize } from 'svgo/browser';
import { ConversionError, svgoConfig } from '@conbert/core';
import { exposeEngine } from './expose-engine';

/** SVG compression with svgo (same settings as on the server). */
exposeEngine({
  init: () => Promise.resolve({ unavailableFormats: [] }),
  convert: (input, _inputExt, _outputExt, options) => {
    const text = new TextDecoder().decode(input);
    try {
      return new TextEncoder().encode(optimize(text, svgoConfig(options)).data);
    } catch (error) {
      throw new ConversionError(
        'errors.convertFailed',
        error instanceof Error ? error.message : String(error),
      );
    }
  },
});
