/**
 * Picture in the spectrogram: every row of a picture becomes a tone (top =
 * high, bottom = low), its brightness the volume over time. A spectrogram
 * viewer then draws the picture again. The other way round: the
 * spectrogram of any sound, drawn with a short-time Fourier transform.
 */

/** Brightness 0–1, row by row; row 0 is the top. */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

export interface ToneOptions {
  seconds: number;
  minHz: number;
  maxHz: number;
  sampleRate: number;
}

export const TONE_DEFAULTS: ToneOptions = {
  seconds: 10,
  minHz: 500,
  maxHz: 15_000,
  sampleRate: 44_100,
};

/** Rows (tones) and columns (time steps) the picture is scaled to. */
export const TONE_ROWS = 200;
export const TONE_MAX_COLUMNS = 600;

/** Time steps the picture is scaled to: a spectrogram shows about 40 per second well. */
export const toneColumns = (seconds: number) =>
  Math.min(TONE_MAX_COLUMNS, Math.max(8, Math.round(seconds * 40)));

/** Brightness from RGBA pixels; transparent counts as dark. `invert` swaps dark and light. */
export function toGray(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  invert = false,
): GrayImage {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) {
    const p = i * 4;
    const luma =
      (0.2126 * (rgba[p] ?? 0) + 0.7152 * (rgba[p + 1] ?? 0) + 0.0722 * (rgba[p + 2] ?? 0)) / 255;
    const alpha = (rgba[p + 3] ?? 255) / 255;
    data[i] = (invert ? 1 - luma : luma) * alpha;
  }
  return { width, height, data };
}

export const averageBrightness = (image: GrayImage) =>
  image.data.reduce((sum, v) => sum + v, 0) / Math.max(1, image.data.length);

/** Turns the picture into sound (mono, −1…1). */
export function imageToSound(image: GrayImage, options: Partial<ToneOptions> = {}): Float32Array {
  const { seconds, minHz, maxHz, sampleRate } = { ...TONE_DEFAULTS, ...options };
  const total = Math.max(1, Math.round(seconds * sampleRate));
  const out = new Float32Array(total);
  const { width, height, data } = image;
  const nyquist = sampleRate / 2;
  const top = Math.min(maxHz, nyquist * 0.98);
  const bottom = Math.max(1, Math.min(minHz, top));
  const amps = new Float32Array(width);
  for (let row = 0; row < height; row++) {
    let loudest = 0;
    for (let x = 0; x < width; x++) {
      const v = data[row * width + x] ?? 0;
      // Squared: a spectrogram shows loudness in decibels, so mid-grey stays mid-grey.
      amps[x] = v * v;
      loudest = Math.max(loudest, amps[x] ?? 0);
    }
    if (loudest < 1e-4) continue;
    const hz = height === 1 ? (top + bottom) / 2 : top - (row / (height - 1)) * (top - bottom);
    const step = (2 * Math.PI * hz) / sampleRate;
    const cos = Math.cos(step);
    const sin = Math.sin(step);
    // A random start phase per tone keeps the tones from adding up to loud peaks.
    const phase = Math.random() * 2 * Math.PI;
    let re = Math.cos(phase);
    let im = Math.sin(phase);
    for (let n = 0; n < total; n++) {
      // Volume glides between the columns, so there are no clicks.
      const pos = (n / total) * width - 0.5;
      const left = Math.max(0, Math.min(width - 1, Math.floor(pos)));
      const right = Math.min(width - 1, left + 1);
      const f = Math.max(0, Math.min(1, pos - left));
      const a = (amps[left] ?? 0) * (1 - f) + (amps[right] ?? 0) * f;
      if (a > 0) out[n] = (out[n] ?? 0) + a * im;
      const nextRe = re * cos - im * sin;
      im = re * sin + im * cos;
      re = nextRe;
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const fade = Math.min(total / 2, Math.round(sampleRate * 0.02));
  const gain = peak > 0 ? 0.89 / peak : 0;
  for (let n = 0; n < total; n++) {
    const edge = Math.min(1, n / fade, (total - 1 - n) / fade);
    out[n] = (out[n] ?? 0) * gain * Math.max(0, edge);
  }
  return out;
}

/** In-place radix-2 FFT (length must be a power of two). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci;
        const ti = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr;
        re[b] = (re[a] ?? 0) - tr;
        im[b] = (im[a] ?? 0) - ti;
        re[a] = (re[a] ?? 0) + tr;
        im[a] = (im[a] ?? 0) + ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/** Loudness 0–1 per time step (columns) and frequency (rows, row 0 = highest). */
export interface Spectrogram {
  width: number;
  height: number;
  data: Float32Array;
  /** Frequency of the top row. */
  maxHz: number;
  seconds: number;
}

export interface SpectrogramOptions {
  fftSize?: number;
  maxColumns?: number;
  maxRows?: number;
  /** Decibels shown below the loudest spot. */
  range?: number;
}

export function spectrogram(
  samples: Float32Array,
  sampleRate: number,
  options: SpectrogramOptions = {},
): Spectrogram {
  const size = options.fftSize ?? 2048;
  const maxColumns = options.maxColumns ?? 1600;
  const maxRows = options.maxRows ?? 512;
  const range = options.range ?? 90;
  const bins = size / 2;
  const columns = Math.max(1, Math.min(maxColumns, Math.ceil(samples.length / (size / 4))));
  const hop = columns > 1 ? Math.max(1, (samples.length - size) / (columns - 1)) : 0;
  const merge = Math.max(1, Math.ceil(bins / maxRows));
  const rows = Math.ceil(bins / merge);
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const db = new Float32Array(columns * rows);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let loudest = -Infinity;
  for (let col = 0; col < columns; col++) {
    const start = Math.round(col * hop);
    for (let i = 0; i < size; i++) {
      re[i] = (samples[start + i] ?? 0) * (window[i] ?? 0);
      im[i] = 0;
    }
    fft(re, im);
    for (let row = 0; row < rows; row++) {
      // Row 0 is the top: the highest frequencies.
      const first = bins - (row + 1) * merge;
      let power = 0;
      for (let b = Math.max(0, first); b < first + merge; b++) {
        power = Math.max(power, (re[b] ?? 0) ** 2 + (im[b] ?? 0) ** 2);
      }
      const value = 10 * Math.log10(power + 1e-20);
      db[row * columns + col] = value;
      loudest = Math.max(loudest, value);
    }
  }
  const data = new Float32Array(db.length);
  if (Number.isFinite(loudest) && loudest > -190) {
    for (let i = 0; i < db.length; i++) {
      data[i] = Math.max(0, Math.min(1, ((db[i] ?? 0) - (loudest - range)) / range));
    }
  }
  return {
    width: columns,
    height: rows,
    data,
    maxHz: sampleRate / 2,
    seconds: samples.length / sampleRate,
  };
}

// Dark violet over red and orange to light yellow – readable for most colour vision.
const STOPS = [
  [0, 0, 4],
  [59, 15, 112],
  [140, 41, 129],
  [222, 73, 104],
  [254, 159, 109],
  [252, 253, 191],
] as const;

/** RGBA pixels for the spectrogram. */
export function colorize(spec: Spectrogram): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(spec.data.length * 4));
  const last = STOPS.length - 1;
  for (let i = 0; i < spec.data.length; i++) {
    const t = (spec.data[i] ?? 0) * last;
    const k = Math.min(last - 1, Math.floor(t));
    const f = t - k;
    const a = STOPS[k] ?? STOPS[0];
    const b = STOPS[k + 1] ?? a;
    out[i * 4] = a[0] + (b[0] - a[0]) * f;
    out[i * 4 + 1] = a[1] + (b[1] - a[1]) * f;
    out[i * 4 + 2] = a[2] + (b[2] - a[2]) * f;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Mono 16-bit WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const put = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  put(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  put(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  put(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return out;
}
