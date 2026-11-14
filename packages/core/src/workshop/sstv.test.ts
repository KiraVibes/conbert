import { describe, expect, it } from 'vitest';
import {
  SSTV_SPECS,
  findVis,
  instantFrequency,
  sstvDecode,
  sstvEncode,
  type SstvMode,
} from './sstv';

const RATE = 11025;

/** A test picture: colour bars at the top, a gradient below. */
function picture(mode: SstvMode): Uint8ClampedArray {
  const { width, height } = SSTV_SPECS[mode];
  const px = new Uint8ClampedArray(width * height * 4);
  const bars = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 255, 255], [0, 0, 0]]; // prettier-ignore
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const c =
        y < height / 2
          ? (bars[Math.floor((x / width) * bars.length)] ?? [0, 0, 0])
          : [x * 0.8, 128, 255 - x * 0.8];
      px.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], o);
    }
  return px;
}

function error(a: Uint8ClampedArray, b: Uint8ClampedArray, width: number, height: number): number {
  let sum = 0;
  let n = 0;
  // Leave out the edges, where neighbouring colours blur into each other.
  for (let y = 4; y < height - 4; y++)
    for (let x = 8; x < width - 8; x++)
      for (let c = 0; c < 3; c++) {
        const o = (y * width + x) * 4 + c;
        sum += Math.abs((a[o] ?? 0) - (b[o] ?? 0));
        n++;
      }
  return sum / n;
}

let seed = 1;
const noise = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;

describe('SSTV', () => {
  it('measures the frequency of a tone', () => {
    const x = new Float32Array(RATE).map((_, i) => Math.sin((2 * Math.PI * 1700 * i) / RATE));
    const f = instantFrequency(x, RATE);
    expect(f[Math.floor(RATE / 2)]).toBeCloseTo(1700, -1);
  });

  for (const mode of ['martin1', 'robot36'] as const) {
    it(`sends and reads back ${mode} (with noise)`, { timeout: 60_000 }, () => {
      const { width, height } = SSTV_SPECS[mode];
      const src = picture(mode);
      const sound = sstvEncode(src, mode, RATE);
      for (let i = 0; i < sound.length; i++) sound[i] = (sound[i] ?? 0) + 0.1 * noise();
      expect(findVis(instantFrequency(sound, RATE), RATE)?.mode).toBe(mode);
      const back = sstvDecode(sound, RATE);
      expect(back?.mode).toBe(mode);
      expect(back?.vis).toBe(true);
      expect(error(src, back?.pixels ?? new Uint8ClampedArray(), width, height)).toBeLessThan(25);
    });
  }

  it(
    'reads a recording that started after the header, with the given mode',
    { timeout: 60_000 },
    () => {
      const src = picture('robot36');
      const sound = sstvEncode(src, 'robot36', RATE);
      const late = sound.subarray(Math.round(RATE * 1.0));
      const back = sstvDecode(late, RATE, 'robot36');
      expect(back?.vis).toBe(false);
      expect(back?.pixels.length).toBe(320 * 240 * 4);
    },
  );
});
