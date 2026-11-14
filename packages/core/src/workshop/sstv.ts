/**
 * SSTV (slow-scan television): pictures as sound, as radio amateurs and the
 * ISS send them. Every pixel is a tone between 1500 Hz (black) and 2300 Hz
 * (white), lines start with a 1200 Hz pulse, and a short header (VIS code)
 * says which mode follows. Two common modes: Martin M1 (colour, 320×256,
 * about 2 minutes) and Robot 36 (colour, 320×240, 36 seconds).
 */

export const SSTV_MODES = ['martin1', 'robot36'] as const;
export type SstvMode = (typeof SSTV_MODES)[number];

interface ModeSpec {
  vis: number;
  width: number;
  height: number;
  /** Duration of one line (Robot 36: one line, chroma alternates). */
  line: number;
  sync: number;
}

export const SSTV_SPECS: Record<SstvMode, ModeSpec> = {
  martin1: { vis: 44, width: 320, height: 256, line: 0.446446, sync: 0.004862 },
  robot36: { vis: 8, width: 320, height: 240, line: 0.15, sync: 0.009 },
};

const BLACK = 1500;
const WHITE = 2300;
const SYNC = 1200;
const toFreq = (v: number) => BLACK + (Math.max(0, Math.min(255, v)) / 255) * (WHITE - BLACK);
const toValue = (f: number) => Math.max(0, Math.min(255, ((f - BLACK) / (WHITE - BLACK)) * 255));

/** Seconds of sound for a picture in this mode (header included). */
export const sstvDuration = (mode: SstvMode) =>
  0.91 + SSTV_SPECS[mode].line * SSTV_SPECS[mode].height;

class Tone {
  private phase = 0;
  private pos = 0;
  private time = 0;
  constructor(
    private readonly out: Float32Array,
    private readonly rate: number,
  ) {}
  /** A tone of `freq` Hz for `seconds`, phase-continuous (no clicks). */
  add(freq: number, seconds: number) {
    this.time += seconds;
    const end = Math.min(this.out.length, Math.round(this.time * this.rate));
    for (; this.pos < end; this.pos++) {
      this.phase += (2 * Math.PI * freq) / this.rate;
      this.out[this.pos] = 0.7 * Math.sin(this.phase);
    }
  }
  get length() {
    return this.pos;
  }
}

function vis(t: Tone, code: number) {
  t.add(1900, 0.3);
  t.add(1200, 0.01);
  t.add(1900, 0.3);
  t.add(1200, 0.03);
  let parity = 0;
  for (let b = 0; b < 7; b++) {
    const bit = (code >> b) & 1;
    parity ^= bit;
    t.add(bit ? 1100 : 1300, 0.03);
  }
  t.add(parity ? 1100 : 1300, 0.03);
  t.add(1200, 0.03);
}

/** YCbCr as Robot 36 sends it (BT.601, 16–235). */
function yuv(r: number, g: number, b: number): [number, number, number] {
  return [
    16 + (65.738 * r + 129.057 * g + 25.064 * b) / 256,
    128 + (-37.945 * r - 74.494 * g + 112.439 * b) / 256,
    128 + (112.439 * r - 94.154 * g - 18.285 * b) / 256,
  ];
}

/**
 * The picture (RGBA, exactly the mode's width × height) as SSTV sound.
 */
export function sstvEncode(rgba: Uint8ClampedArray, mode: SstvMode, rate: number): Float32Array {
  const spec = SSTV_SPECS[mode];
  const out = new Float32Array(Math.ceil((sstvDuration(mode) + 0.3) * rate));
  const t = new Tone(out, rate);
  t.add(0, 0.25); // a moment of silence before
  vis(t, spec.vis);
  const px = (x: number, y: number, c: number) => rgba[(y * spec.width + x) * 4 + c] ?? 0;
  const scan = (y: number, seconds: number, value: (x: number) => number, width = spec.width) => {
    for (let x = 0; x < width; x++) t.add(toFreq(value(x)), seconds / width);
  };
  for (let y = 0; y < spec.height; y++) {
    if (mode === 'martin1') {
      t.add(SYNC, 0.004862);
      t.add(BLACK, 0.000572);
      for (const c of [1, 2, 0]) {
        scan(y, 0.146432, (x) => px(x, y, c));
        t.add(BLACK, 0.000572);
      }
    } else {
      t.add(SYNC, 0.009);
      t.add(BLACK, 0.003);
      scan(y, 0.088, (x) => yuv(px(x, y, 0), px(x, y, 1), px(x, y, 2))[0]);
      // Even lines carry R−Y, odd lines B−Y – each for two lines (half width).
      const even = y % 2 === 0;
      t.add(even ? BLACK : WHITE, 0.0045);
      t.add(1900, 0.0015);
      const pair = even ? y : y - 1;
      scan(
        y,
        0.044,
        (x) => {
          const a = yuv(px(x * 2, pair, 0), px(x * 2, pair, 1), px(x * 2, pair, 2));
          const b = yuv(px(x * 2, pair + 1, 0), px(x * 2, pair + 1, 1), px(x * 2, pair + 1, 2));
          return even ? (a[2] + b[2]) / 2 : (a[1] + b[1]) / 2;
        },
        spec.width / 2,
      );
    }
  }
  t.add(0, 0.1);
  return out.subarray(0, t.length);
}

/**
 * The frequency at every sample: a Hilbert filter gives the 90°-shifted
 * twin of the sound, together they turn like a hand on a clock – how fast
 * it turns from sample to sample is the frequency. A short average then
 * calms the noise.
 */
export function instantFrequency(x: Float32Array, rate: number): Float32Array {
  const n = x.length;
  const M = Math.max(8, Math.round(rate / 700));
  const taps: number[] = [];
  for (let k = -M; k <= M; k++)
    taps.push(k % 2 === 0 ? 0 : (2 / (Math.PI * k)) * (0.54 + 0.46 * Math.cos((Math.PI * k) / M)));
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -M; k <= M; k += 1) {
      const t = taps[k + M] ?? 0;
      if (t !== 0) sum += t * (x[i - k] ?? 0);
    }
    im[i] = sum;
  }
  const raw = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const a = x[i] ?? 0;
    const b = im[i] ?? 0;
    const c = x[i - 1] ?? 0;
    const d = -(im[i - 1] ?? 0);
    raw[i] = (Math.atan2(b * c + a * d, a * c - b * d) * rate) / (2 * Math.PI);
  }
  raw[0] = raw[1] ?? 0;
  // Centred moving average of about a third of a millisecond.
  const len = Math.max(1, Math.round(rate / 3000));
  const f = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n + len; i++) {
    if (i < n) sum += raw[i] ?? 0;
    if (i >= len) sum -= raw[i - len] ?? 0;
    const at = i - Math.floor(len / 2);
    if (at >= 0 && at < n) f[at] = sum / Math.min(len, i + 1);
  }
  return f;
}

const mean = (f: Float32Array, from: number, to: number) => {
  let s = 0;
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(f.length, Math.max(a + 1, Math.floor(to)));
  for (let i = a; i < b; i++) s += f[i] ?? 0;
  return s / Math.max(1, b - a);
};

/** Finds the VIS header: returns its mode and where the picture starts. */
export function findVis(
  f: Float32Array,
  rate: number,
): { mode: SstvMode | null; code: number; start: number } | null {
  const ms = rate / 1000;
  const step = Math.round(ms * 2);
  for (let i = 0; i + 700 * ms < f.length; i += step) {
    // Leader (1900), break (1200), leader (1900), start bit (1200).
    if (Math.abs(mean(f, i, i + 250 * ms) - 1900) > 60) continue;
    // Find the start bit: the 1200 Hz edge after the second leader.
    let s = i + 250 * ms;
    const limit = i + 700 * ms;
    while (s < limit && mean(f, s, s + 5 * ms) > 1550) s += ms / 2;
    if (s >= limit) continue;
    // Skip the 10 ms break if this was it (another 1900 Hz leader follows).
    if (Math.abs(mean(f, s + 15 * ms, s + 250 * ms) - 1900) < 60) {
      s += 15 * ms;
      while (s < limit + 300 * ms && mean(f, s, s + 5 * ms) > 1550) s += ms / 2;
    }
    if (Math.abs(mean(f, s + 5 * ms, s + 25 * ms) - 1200) > 80) continue;
    let code = 0;
    let parity = 0;
    for (let b = 0; b < 8; b++) {
      const at = s + 30 * ms * (b + 1);
      const bit = mean(f, at + 5 * ms, at + 25 * ms) < 1200 ? 1 : 0;
      if (b < 7) code |= bit << b;
      parity ^= bit;
    }
    if (parity !== 0) continue;
    const mode =
      (Object.keys(SSTV_SPECS) as SstvMode[]).find((m) => SSTV_SPECS[m].vis === code) ?? null;
    return { mode, code, start: s + 30 * ms * 10 };
  }
  return null;
}

/** Where the next line's sync pulse starts, searched around `expected`. */
function findSync(
  f: Float32Array,
  expected: number,
  rate: number,
  sync: number,
  slack: number,
): number {
  const len = Math.round(sync * rate);
  let best = expected;
  let bestScore = Infinity;
  const from = Math.max(0, Math.round(expected - slack));
  const to = Math.min(f.length - len, Math.round(expected + slack));
  for (let i = from; i <= to; i += 2) {
    const score = Math.abs(mean(f, i, i + len) - SYNC);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore < 150 ? best : expected;
}

export interface SstvPicture {
  mode: SstvMode;
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
  /** The VIS header was found (else the mode was given). */
  vis: boolean;
}

/**
 * Reads an SSTV recording back into a picture. Without a header (recording
 * started late), `fallback` says the mode and the first sync pulse is used.
 */
export function sstvDecode(
  samples: Float32Array,
  rate: number,
  fallback: SstvMode = 'robot36',
): SstvPicture | null {
  const f = instantFrequency(samples, rate);
  const header = findVis(f, rate);
  const mode = header?.mode ?? fallback;
  const spec = SSTV_SPECS[mode];
  const ms = rate / 1000;
  let pos: number;
  if (header?.mode) pos = header.start;
  else {
    // The first sync pulse in the recording.
    pos = findSync(f, spec.sync * rate, rate, spec.sync, f.length / 2);
  }
  const pixels = new Uint8ClampedArray(spec.width * spec.height * 4);
  const lineLen = spec.line * rate;
  const half = spec.width / 2;
  // Robot 36: brightness per line, colour difference per line (R−Y or B−Y).
  const luma: Float32Array[] = [];
  const crs: (Float32Array | undefined)[] = [];
  const cbs: (Float32Array | undefined)[] = [];
  const read = (start: number, seconds: number, count: number) => {
    const w = (seconds * rate) / count;
    const out = new Float32Array(count);
    for (let x = 0; x < count; x++)
      out[x] = toValue(mean(f, start + x * w + w * 0.2, start + (x + 1) * w - w * 0.2));
    return out;
  };
  let lines = 0;
  for (let y = 0; y < spec.height; y++) {
    // Follow the sync pulses: corrects small differences in the sample rate.
    pos = findSync(f, pos, rate, spec.sync, 3 * ms);
    if (pos + lineLen > f.length + ms) break;
    lines = y + 1;
    if (mode === 'martin1') {
      let at = pos + (0.004862 + 0.000572) * rate;
      for (const c of [1, 2, 0]) {
        const values = read(at, 0.146432, spec.width);
        for (let x = 0; x < spec.width; x++) pixels[(y * spec.width + x) * 4 + c] = values[x] ?? 0;
        at += (0.146432 + 0.000572) * rate;
      }
    } else {
      const yAt = pos + 0.012 * rate;
      luma[y] = read(yAt, 0.088, spec.width);
      const sepAt = yAt + 0.088 * rate;
      // The separator says which colour difference follows (1500 = R−Y, 2300 = B−Y).
      const blue = mean(f, sepAt + ms, sepAt + 4 * ms) > 1900;
      (blue ? cbs : crs)[y] = read(sepAt + 0.006 * rate, 0.044, half);
    }
    pos += lineLen;
  }
  for (let y = 0; y < lines; y++) {
    for (let x = 0; x < spec.width; x++) pixels[(y * spec.width + x) * 4 + 3] = 255;
    if (mode !== 'robot36') continue;
    // A line pair shares its colours: R−Y from one line, B−Y from the other.
    const pair = y - (y % 2);
    const cr = crs[pair] ?? crs[pair + 1];
    const cb = cbs[pair + 1] ?? cbs[pair];
    const l = luma[y];
    if (!l) continue;
    for (let x = 0; x < spec.width; x++) {
      const yy = 1.164 * ((l[x] ?? 16) - 16);
      const r = (cr?.[x >> 1] ?? 128) - 128;
      const b = (cb?.[x >> 1] ?? 128) - 128;
      const o = (y * spec.width + x) * 4;
      pixels[o] = yy + 1.596 * r;
      pixels[o + 1] = yy - 0.392 * b - 0.813 * r;
      pixels[o + 2] = yy + 2.017 * b;
    }
  }
  if (lines === 0) return null;
  return { mode, width: spec.width, height: spec.height, pixels, vis: Boolean(header?.mode) };
}
