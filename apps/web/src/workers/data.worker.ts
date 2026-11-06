import { convertData } from '@conbert/core/data';
import { exposeEngine } from './expose-engine';

exposeEngine({
  init: () => Promise.resolve({ unavailableFormats: [] }),
  convert: (input, inputExt, outputExt, options) =>
    convertData(input, inputExt, outputExt, options),
});
