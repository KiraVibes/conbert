import {
  BasicMIDI,
  SoundBankLoader,
  SpessaSynthProcessor,
  SpessaSynthSequencer,
  audioToWav,
  type BasicSoundBank,
} from 'spessasynth_core';
import { ConversionError, normalizeExt } from '@conbert/core';

type Progress = (percent: number, stage?: string) => void;

const SAMPLE_RATE = 44_100;
/** Small blocks keep modulators and LFOs accurate (recommended by spessasynth). */
const BLOCK = 128;
/** Reverb and release tails after the last note. */
const TAIL_SECONDS = 2;
/** Guards against endless files (e.g. broken tempo maps): 2 hours. */
const MAX_SECONDS = 2 * 60 * 60;

const toArrayBuffer = (data: Uint8Array): ArrayBuffer =>
  data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? (data.buffer as ArrayBuffer)
    : (data.slice().buffer as ArrayBuffer);

function parse<T>(what: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new ConversionError(
      'errors.convertFailed',
      `${what}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function loadSoundBank(data: Uint8Array): BasicSoundBank {
  return parse('sound bank', () => SoundBankLoader.fromArrayBuffer(toArrayBuffer(data)));
}

/**
 * Plays a MIDI file through the synthesizer and records it as a WAV file.
 * RMI files that bring their own instruments use those; everything else uses
 * the given sound bank (GeneralUser GS).
 */
export async function renderMidi(
  midiData: Uint8Array,
  defaultBank: () => Promise<BasicSoundBank>,
  onProgress: Progress,
): Promise<Uint8Array> {
  const midi = parse('MIDI', () => BasicMIDI.fromArrayBuffer(toArrayBuffer(midiData)));
  if (!Number.isFinite(midi.duration) || midi.duration <= 0) {
    throw new ConversionError('errors.noMatchingStream', 'MIDI file contains no notes');
  }
  if (midi.duration > MAX_SECONDS) {
    throw new ConversionError('errors.convertFailed', `MIDI too long: ${midi.duration}s`);
  }

  const bank = midi.embeddedSoundBank
    ? loadSoundBank(new Uint8Array(midi.embeddedSoundBank))
    : await defaultBank();

  const synth = new SpessaSynthProcessor(SAMPLE_RATE, { eventsEnabled: false });
  synth.soundBankManager.addSoundBank(bank, 'main');
  await synth.processorInitialized;
  synth.setSystemParameter('autoAllocateVoices', true);
  const sequencer = new SpessaSynthSequencer(synth);
  sequencer.loadNewSongList([midi]);
  sequencer.play();

  const total = Math.ceil(SAMPLE_RATE * (midi.duration + TAIL_SECONDS));
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let filled = 0;
  let lastPercent = -1;
  while (filled < total) {
    sequencer.processTick();
    const size = Math.min(BLOCK, total - filled);
    synth.process(left, right, filled, size);
    filled += size;
    const percent = Math.floor((filled / total) * 95);
    if (percent !== lastPercent) {
      lastPercent = percent;
      onProgress(percent, 'converting');
    }
  }
  onProgress(97, 'writing');
  return new Uint8Array(audioToWav([left, right], SAMPLE_RATE));
}

/** SF2 ↔ DLS. SF3 can be read but not written: that would need a Vorbis encoder. */
export function convertSoundBank(data: Uint8Array, outputExt: string): Uint8Array {
  const bank = loadSoundBank(data);
  const ext = normalizeExt(outputExt);
  const software = 'Conbert';
  try {
    if (ext === 'sf2') {
      return new Uint8Array(
        bank.writeSF2({ software, writeDefaultModulators: true, writeExtendedLimits: true }),
      );
    }
    if (ext === 'dls') return new Uint8Array(bank.writeDLS({ software }));
  } catch (error) {
    throw new ConversionError(
      'errors.convertFailed',
      error instanceof Error ? error.message : String(error),
    );
  }
  throw new ConversionError('errors.formatUnavailable', `can't write .${ext}`);
}
