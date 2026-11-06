import type { BasicSoundBank } from 'spessasynth_core';
import { loadSoundBank, renderMidi } from '@/engines/spessasynth-convert';
import { exposeEngine } from './expose-engine';

/** GeneralUser GS, served by Conbert itself (scripts/fetch-soundfont.mjs). */
const SOUNDFONT_URL = '/soundfonts/GeneralUser-GS.sf2';

let bank: Promise<BasicSoundBank> | null = null;

/** Loaded on first use only: ~32 MB, cached by the browser afterwards. */
function defaultBank(): Promise<BasicSoundBank> {
  bank ??= fetch(new URL(SOUNDFONT_URL, self.location.origin))
    .then(async (response) => {
      if (!response.ok) throw new Error(`soundfont: HTTP ${response.status}`);
      return loadSoundBank(new Uint8Array(await response.arrayBuffer()));
    })
    .catch((error: unknown) => {
      bank = null;
      throw error;
    });
  return bank;
}

exposeEngine({
  async init() {
    await defaultBank();
    return { unavailableFormats: [] };
  },
  convert: (input, _inputExt, _outputExt, _options, onProgress) =>
    renderMidi(input, defaultBank, onProgress),
});
