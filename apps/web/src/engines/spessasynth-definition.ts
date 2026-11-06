import type { Engine } from '@conbert/core';

/**
 * spessasynth (spessasynth_core, the WebAudio-free part of SpessaSynth): it
 * runs in a Web Worker without an AudioContext. MIDI → WAV only; the router
 * chains WAV → MP3/OGG/… with mediabunny or ffmpeg.wasm.
 */
export const SPESSASYNTH_MIDI_META = {
  id: 'spessasynth-midi',
  name: 'SpessaSynth MIDI (Browser)',
  descriptionKey: 'engines.spessasynthMidi.description',
  category: 'midi',
  runtime: 'browser',
  formats: [
    { ext: 'mid', canRead: true, canWrite: false },
    { ext: 'wav', canRead: false, canWrite: true },
  ],
  options: [],
  supportsCompression: false,
  priority: 10,
} as const satisfies Omit<Engine, 'init' | 'status' | 'convert'>;

export const SPESSASYNTH_SOUNDFONT_META = {
  id: 'spessasynth-soundfont',
  name: 'SpessaSynth Soundfonts (Browser)',
  descriptionKey: 'engines.spessasynthSoundfont.description',
  category: 'audio',
  runtime: 'browser',
  formats: [
    { ext: 'sf2', canRead: true, canWrite: true },
    { ext: 'sf3', canRead: true, canWrite: false },
    { ext: 'dls', canRead: true, canWrite: true },
  ],
  options: [],
  supportsCompression: false,
  priority: 10,
} as const satisfies Omit<Engine, 'init' | 'status' | 'convert'>;
