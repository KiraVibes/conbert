import { SPESSASYNTH_MIDI_META, SPESSASYNTH_SOUNDFONT_META } from './spessasynth-definition';
import { createWorkerEngine } from './worker-engine';

/** MIDI → WAV with the GeneralUser GS soundfont (loaded on first use). */
export const spessasynthMidiEngine = createWorkerEngine({
  meta: SPESSASYNTH_MIDI_META,
  needsIsolation: false,
  createWorker: () =>
    new Worker(new URL('../workers/spessasynth-midi.worker.ts', import.meta.url), {
      type: 'module',
      name: 'spessasynth-midi',
    }),
});

/** Soundfont conversion: SF2/SF3/DLS → SF2 or DLS. */
export const spessasynthSoundfontEngine = createWorkerEngine({
  meta: SPESSASYNTH_SOUNDFONT_META,
  needsIsolation: false,
  createWorker: () =>
    new Worker(new URL('../workers/spessasynth-soundfont.worker.ts', import.meta.url), {
      type: 'module',
      name: 'spessasynth-soundfont',
    }),
});
