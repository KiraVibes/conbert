import { convertSoundBank } from '@/engines/spessasynth-convert';
import { exposeEngine } from './expose-engine';

exposeEngine({
  init: () => Promise.resolve({ unavailableFormats: [] }),
  convert: (input, _inputExt, outputExt) => convertSoundBank(input, outputExt),
});
