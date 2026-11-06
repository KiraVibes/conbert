import { convertWithMediabunny, ensureMp3Encoder } from '@/engines/mediabunny-convert';
import { exposeEngine } from './expose-engine';

exposeEngine({
  async init() {
    // WebCodecs is the whole point; without it only copying and WAV would work.
    if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
      throw new Error('WebCodecs is not available in this browser');
    }
    await ensureMp3Encoder();
    return { unavailableFormats: [] };
  },
  convert: convertWithMediabunny,
});
