/**
 * Klingelton-Maker: a part of a song with a soft start and end, as MP3 (most
 * phones) or M4R (iPhone). The sound work happens here on plain samples; the
 * browser decodes and ffmpeg.wasm encodes.
 */

/** iPhones refuse ringtones longer than 40 seconds. */
export const RINGTONE_MAX_SECONDS = 40;
export const RINGTONE_DEFAULT_SECONDS = 30;
export const RINGTONE_MIN_SECONDS = 1;
export const RINGTONE_FORMATS = ['mp3', 'm4r'] as const;
export type RingtoneFormat = (typeof RINGTONE_FORMATS)[number];
export const RINGTONE_MAX_FADE = 5;

/**
 * Keeps a chosen part inside the song and no longer than allowed. Moving
 * the start keeps the length where possible.
 */
export function clampPart(
  start: number,
  end: number,
  duration: number,
  maxSeconds = RINGTONE_MAX_SECONDS,
): { start: number; end: number } {
  const total = Math.max(0, duration);
  let s = Math.min(Math.max(0, start), Math.max(0, total - RINGTONE_MIN_SECONDS));
  let e = Math.min(Math.max(end, s + RINGTONE_MIN_SECONDS), total);
  if (e - s > maxSeconds) e = s + maxSeconds;
  if (e - s < RINGTONE_MIN_SECONDS) s = Math.max(0, e - RINGTONE_MIN_SECONDS);
  return { start: round(s), end: round(e) };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The samples between start and end (seconds), per channel. */
export function cutChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  start: number,
  end: number,
): Float32Array[] {
  const from = Math.max(0, Math.floor(start * sampleRate));
  return channels.map((ch) => ch.slice(from, Math.max(from, Math.floor(end * sampleRate))));
}

/**
 * Soft start and end (in place). The curve is a quarter sine: it sounds
 * smoother than a straight line, because ears hear loudness logarithmically.
 */
export function applyFades(
  channels: Float32Array[],
  sampleRate: number,
  fadeIn: number,
  fadeOut: number,
): void {
  const length = channels[0]?.length ?? 0;
  const inSamples = Math.min(length, Math.round(Math.max(0, fadeIn) * sampleRate));
  const outSamples = Math.min(length, Math.round(Math.max(0, fadeOut) * sampleRate));
  for (const ch of channels) {
    for (let i = 0; i < inSamples; i++) {
      ch[i] = (ch[i] ?? 0) * Math.sin(((i / inSamples) * Math.PI) / 2);
    }
    for (let i = 0; i < outSamples; i++) {
      const at = length - 1 - i;
      ch[at] = (ch[at] ?? 0) * Math.sin(((i / outSamples) * Math.PI) / 2);
    }
  }
}

/**
 * Makes the part as loud as it can get without distortion: the loudest
 * sample ends up at `peakDb` (−1 dB leaves a little room for MP3/AAC).
 * Returns the factor used (1 = unchanged, e.g. for silence).
 */
export function normalizePeak(channels: Float32Array[], peakDb = -1): number {
  let peak = 0;
  for (const ch of channels) for (const s of ch) peak = Math.max(peak, Math.abs(s));
  if (peak < 1e-4) return 1;
  const factor = 10 ** (peakDb / 20) / peak;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] = (ch[i] ?? 0) * factor;
  return factor;
}

/** 16-bit WAV with one or two channels (more are mixed down to two). */
export function encodeWavChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
): Uint8Array {
  const used = channels.length > 2 ? mixToStereo(channels) : [...channels];
  const count = Math.max(1, used.length);
  const frames = used[0]?.length ?? 0;
  const dataBytes = frames * count * 2;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const put = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  put(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  put(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, count, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * count * 2, true);
  v.setUint16(32, count * 2, true);
  v.setUint16(34, 16, true);
  put(36, 'data');
  v.setUint32(40, dataBytes, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const s = Math.max(-1, Math.min(1, used[c]?.[i] ?? 0));
      v.setInt16(at, Math.round(s * 32767), true);
      at += 2;
    }
  }
  return out;
}

function mixToStereo(channels: readonly Float32Array[]): Float32Array[] {
  const frames = channels[0]?.length ?? 0;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  channels.forEach((ch, c) => {
    const target = c % 2 === 0 ? left : right;
    for (let i = 0; i < frames; i++)
      target[i] = (target[i] ?? 0) + (ch[i] ?? 0) / Math.ceil(channels.length / 2);
  });
  return [left, right];
}

/**
 * Loudness outline for drawing: the highest level in each of `buckets`
 * slices (0…1), from the first channel mixed with the second.
 */
export function waveformPeaks(channels: readonly Float32Array[], buckets: number): Float32Array {
  const length = channels[0]?.length ?? 0;
  const out = new Float32Array(Math.max(1, buckets));
  if (length === 0) return out;
  const size = length / out.length;
  for (let b = 0; b < out.length; b++) {
    const from = Math.floor(b * size);
    const to = Math.min(length, Math.max(from + 1, Math.floor((b + 1) * size)));
    // Every sample is too slow for long songs; 400 per slice is plenty to draw.
    const step = Math.max(1, Math.floor((to - from) / 400));
    let peak = 0;
    for (let i = from; i < to; i += step) {
      for (const ch of channels.slice(0, 2)) peak = Math.max(peak, Math.abs(ch[i] ?? 0));
    }
    out[b] = Math.min(1, peak);
  }
  return out;
}
