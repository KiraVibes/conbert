/**
 * Test files: files of an exact size and small sample media (test picture,
 * test tone, PDF with numbered pages, test video) – handy to try upload
 * limits, storage locations and players. Pure functions; the browser turns
 * the results into PNG/PDF/MP4.
 */

export const TEST_FILE_KINDS = ['size', 'image', 'audio', 'pdf', 'video'] as const;
export type TestFileKind = (typeof TEST_FILE_KINDS)[number];

/** What a file of an exact size is filled with. */
export const TEST_FILLS = ['zeros', 'random', 'text'] as const;
export type TestFill = (typeof TEST_FILLS)[number];

export const TEST_SIZE_UNITS = ['KB', 'MB', 'GB'] as const;
export type TestSizeUnit = (typeof TEST_SIZE_UNITS)[number];

/** Browsers keep the whole file in memory (or spill to disk) – 4 GB is plenty for tests. */
export const TEST_MAX_BYTES = 4 * 1024 ** 3;

/** Binary units (1 MB = 1024 KB), like Windows and most upload limits count. */
export function testSizeBytes(amount: number, unit: TestSizeUnit): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const factor = unit === 'KB' ? 1024 : unit === 'MB' ? 1024 ** 2 : 1024 ** 3;
  const bytes = Math.round(amount * factor);
  return bytes >= 1 && bytes <= TEST_MAX_BYTES ? bytes : null;
}

const CHUNK = 1024 * 1024;
/** crypto.getRandomValues fills at most 64 KiB per call. */
const RANDOM_STEP = 65_536;

function textChunk(size: number, startLine: number): { bytes: Uint8Array; nextLine: number } {
  const out = new Uint8Array(size);
  let at = 0;
  let line = startLine;
  const encoder = new TextEncoder();
  while (at < size) {
    const row = encoder.encode(
      `Conbert test file - line ${String(line).padStart(9, '0')} - abcdefghijklmnopqrstuvwxyz\n`,
    );
    out.set(row.subarray(0, Math.min(row.length, size - at)), at);
    at += row.length;
    line++;
  }
  return { bytes: out, nextLine: line };
}

/**
 * The content of a file of exactly `size` bytes, in pieces of up to 1 MB
 * (a Blob of these pieces never needs one huge buffer). Zeros reuse one
 * piece; random data is new for every piece, so nothing repeats.
 */
export function* testFileChunks(size: number, fill: TestFill): Generator<Uint8Array> {
  const zeros = fill === 'zeros' ? new Uint8Array(Math.min(CHUNK, size)) : null;
  let left = size;
  let line = 1;
  while (left > 0) {
    const n = Math.min(CHUNK, left);
    if (zeros) {
      yield n === zeros.length ? zeros : zeros.subarray(0, n);
    } else if (fill === 'random') {
      const out = new Uint8Array(n);
      for (let at = 0; at < n; at += RANDOM_STEP) {
        crypto.getRandomValues(out.subarray(at, Math.min(n, at + RANDOM_STEP)));
      }
      yield out;
    } else {
      const piece = textChunk(n, line);
      line = piece.nextLine;
      yield piece.bytes;
    }
    left -= n;
  }
}

/** A name that says what the file is: "test-25MB-random.bin". */
export function testFileName(amount: number, unit: TestSizeUnit, fill: TestFill, ext: string) {
  const clean = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  const size = String(amount).replace('.', ',');
  return `test-${size}${unit}-${fill}.${clean}`;
}

// --- Test tone ---------------------------------------------------------------

export const TEST_TONES = ['sine', 'sweep', 'beeps', 'stereo'] as const;
export type TestTone = (typeof TEST_TONES)[number];

export const TEST_AUDIO_MAX_SECONDS = 600;

/**
 * A test sound as two channels (left, right):
 * - sine: 440 Hz (concert pitch A) on both sides
 * - sweep: 20 Hz → 20 kHz – where you stop hearing it, your speakers (or ears) end
 * - beeps: one short beep per second, a higher one every 5 s (to check sync and cutting)
 * - stereo: a tone that alternates left / right every second
 */
export function testToneChannels(
  kind: TestTone,
  seconds: number,
  sampleRate = 44_100,
): [Float32Array, Float32Array] {
  const length = Math.max(1, Math.round(Math.min(seconds, TEST_AUDIO_MAX_SECONDS) * sampleRate));
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const volume = 0.5;
  // Sweep: exponential, so every octave gets the same time.
  const f0 = 20;
  const f1 = 20_000;
  const total = length / sampleRate;
  const k = Math.log(f1 / f0);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let l = 0;
    let r = 0;
    if (kind === 'sine') {
      l = r = Math.sin(2 * Math.PI * 440 * t);
    } else if (kind === 'sweep') {
      const phase = ((2 * Math.PI * f0 * total) / k) * (Math.exp((k * t) / total) - 1);
      l = r = Math.sin(phase);
    } else if (kind === 'beeps') {
      const second = Math.floor(t);
      const within = t - second;
      if (within < 0.1) {
        const freq = second % 5 === 0 ? 1760 : 880;
        // Short fade in/out against clicks.
        const env = Math.min(1, within / 0.005, (0.1 - within) / 0.005);
        l = r = Math.sin(2 * Math.PI * freq * t) * env;
      }
    } else {
      const s = Math.sin(2 * Math.PI * 440 * t);
      const within = t - Math.floor(t);
      const env = Math.min(1, within / 0.01, (1 - within) / 0.01);
      if (Math.floor(t) % 2 === 0) l = s * env;
      else r = s * env;
    }
    left[i] = l * volume;
    right[i] = r * volume;
  }
  return [left, right];
}

// --- Test picture ------------------------------------------------------------

export const TEST_IMAGE_MAX_SIDE = 8192;

/** The seven classic colour bars (white, yellow, cyan, green, magenta, red, blue). */
export const TEST_BARS: readonly (readonly [number, number, number])[] = [
  [235, 235, 235],
  [235, 235, 16],
  [16, 235, 235],
  [16, 235, 16],
  [235, 16, 235],
  [235, 16, 16],
  [16, 16, 235],
];

/**
 * A test picture as RGBA pixels: colour bars on top, a grey ramp in the
 * middle, a grid with a circle (shows stretching) and a 1-pixel border (shows
 * cropping). Text (the size) is drawn on top by the browser.
 */
export function testImagePixels(width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const w = Math.max(1, Math.min(TEST_IMAGE_MAX_SIDE, Math.round(width)));
  const h = Math.max(1, Math.min(TEST_IMAGE_MAX_SIDE, Math.round(height)));
  const px = new Uint8ClampedArray(w * h * 4);
  const barsEnd = Math.round(h * 0.4);
  const rampEnd = Math.round(h * 0.55);
  const cx = w / 2;
  const cy = (rampEnd + h) / 2;
  const radius = Math.min(w, h - rampEnd) * 0.4;
  const grid = Math.max(8, Math.round(Math.min(w, h) / 16));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c: readonly [number, number, number];
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        c = [255, 0, 0];
      } else if (y < barsEnd) {
        c = TEST_BARS[Math.min(6, Math.floor((x / w) * 7))] ?? [0, 0, 0];
      } else if (y < rampEnd) {
        const g = Math.round((x / Math.max(1, w - 1)) * 255);
        c = [g, g, g];
      } else {
        const d = Math.hypot(x - cx, y - cy);
        const onCircle = Math.abs(d - radius) < Math.max(1, grid / 12);
        const onGrid = x % grid === 0 || (y - rampEnd) % grid === 0;
        c = onCircle ? [255, 200, 0] : onGrid ? [90, 90, 90] : [24, 24, 32];
      }
      const o = (y * w + x) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = 255;
    }
  }
  return px;
}

export const TEST_PDF_MAX_PAGES = 2000;
export const TEST_VIDEO_MAX_SECONDS = 300;
