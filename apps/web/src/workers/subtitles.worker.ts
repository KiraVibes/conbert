import { convertSubtitles } from '@conbert/core/subtitles';
import { exposeEngine } from './expose-engine';

exposeEngine({
  init: () => Promise.resolve({ unavailableFormats: [] }),
  convert: (input, inputExt, outputExt, options) =>
    convertSubtitles(input, inputExt, outputExt, options),
});
