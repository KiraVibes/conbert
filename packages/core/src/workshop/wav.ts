import { StegoError, type Carrier } from './stego';

/**
 * Just enough WAV to hide bits in the samples: finds the format and the
 * sample data and leaves every other chunk (tags, cue points) untouched.
 */

export interface WavInfo {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** Samples are floating-point numbers (32/64 bit) instead of whole numbers. */
  float: boolean;
  /** Where the samples start and how many bytes they take. */
  dataOffset: number;
  dataLength: number;
  /** Samples per channel. */
  frames: number;
}

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

const tag = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);

/** Reads the header of a WAV file; throws `no-audio` for anything else. */
export function parseWav(bytes: Uint8Array): WavInfo {
  if (bytes.length < 12 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') {
    throw new StegoError('no-audio');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: Omit<WavInfo, 'dataOffset' | 'dataLength' | 'frames'> | null = null;
  let blockAlign = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(bytes, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ' && size >= 16) {
      let code = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is in the first two bytes of the sub-format GUID.
      if (code === EXTENSIBLE && size >= 40) code = view.getUint16(body + 24, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      const float = code === FLOAT;
      if ((code !== PCM && !float) || bitsPerSample % 8 !== 0 || bitsPerSample === 0) {
        throw new StegoError('no-audio');
      }
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample,
        float,
      };
      blockAlign = view.getUint16(body + 12, true);
    } else if (id === 'data' && format) {
      // Recorders that were stopped hard may leave the size open (0 or too big).
      const dataLength = Math.min(size || bytes.length, bytes.length - body);
      const frameBytes = blockAlign || (format.channels * format.bitsPerSample) / 8;
      const frames = frameBytes > 0 ? Math.floor(dataLength / frameBytes) : 0;
      if (format.channels === 0 || frames === 0) throw new StegoError('no-audio');
      return { ...format, dataOffset: body, dataLength: frames * frameBytes, frames };
    }
    at = body + size + (size & 1);
  }
  throw new StegoError('no-audio');
}

/**
 * The samples as carrier: the first (lowest) byte of every sample. A change
 * there is the quietest possible change, about 96 dB below full volume at 16 bit.
 */
export function wavCarrier(bytes: Uint8Array, info: WavInfo = parseWav(bytes)): Carrier {
  const step = info.bitsPerSample / 8;
  const count = Math.floor(info.dataLength / step);
  const positions = new Uint32Array(count);
  for (let i = 0; i < count; i++) positions[i] = info.dataOffset + i * step;
  return { data: bytes, positions };
}

/** Length in seconds. */
export const wavDuration = (info: WavInfo) =>
  info.sampleRate > 0 ? info.frames / info.sampleRate : 0;
