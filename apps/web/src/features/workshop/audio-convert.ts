import { ffmpegWasmEngine } from '@/engines/ffmpeg-wasm';

/** Sound files for the workshop: conversions with ffmpeg.wasm and decoding. */

export const extOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';

export async function ffmpeg(input: Blob, from: string, to: 'wav' | 'flac'): Promise<Blob> {
  const out = await ffmpegWasmEngine.convert({ input, inputExt: from, outputExt: to, options: {} });
  if (typeof out === 'string') throw new Error('unexpected path from a browser engine');
  return out;
}

/** The file as WAV: a WAV stays as it is, anything else becomes 16-bit WAV. */
export const asWav = (file: Blob, ext: string) => (ext === 'wav' ? file : ffmpeg(file, ext, 'wav'));

export interface DecodedSound {
  /** Mono mix of all channels. */
  samples: Float32Array;
  sampleRate: number;
}

const DECODE_RATE = 44_100;

async function decode(file: Blob): Promise<DecodedSound> {
  const context = new OfflineAudioContext(1, 1, DECODE_RATE);
  const buffer = await context.decodeAudioData(await file.arrayBuffer());
  const samples = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = (samples[i] ?? 0) + (channel[i] ?? 0) / buffer.numberOfChannels;
    }
  }
  return { samples, sampleRate: buffer.sampleRate };
}

/** Decodes with the browser; what it can't read goes through ffmpeg.wasm first. */
export async function decodeSound(file: File): Promise<DecodedSound> {
  try {
    return await decode(file);
  } catch {
    const ext = extOf(file.name);
    if (!ext || ext === 'wav') throw new Error('not a sound file');
    return decode(await ffmpeg(file, ext, 'wav'));
  }
}
