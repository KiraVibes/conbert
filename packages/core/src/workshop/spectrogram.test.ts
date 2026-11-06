import { describe, expect, it } from 'vitest';
import {
  averageBrightness,
  colorize,
  encodeWav,
  fft,
  imageToSound,
  spectrogram,
  toGray,
  type GrayImage,
} from './spectrogram';
import { parseWav } from './wav';

const RATE = 22_050;

function blank(width: number, height: number): GrayImage {
  return { width, height, data: new Float32Array(width * height) };
}

/** Row with the most energy, summed over all columns. */
function loudestRow(spec: ReturnType<typeof spectrogram>, from = 0, to = spec.width): number {
  let best = 0;
  let bestSum = -1;
  for (let row = 0; row < spec.height; row++) {
    let sum = 0;
    for (let col = from; col < to; col++) sum += spec.data[row * spec.width + col] ?? 0;
    if (sum > bestSum) [best, bestSum] = [row, sum];
  }
  return best;
}

describe('spectrogram', () => {
  it('finds a sine tone with the FFT', () => {
    const n = 1024;
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 50 * i) / n));
    const im = new Float64Array(n);
    fft(re, im);
    const mags = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k] ?? 0, im[k] ?? 0));
    expect(mags.indexOf(Math.max(...mags))).toBe(50);
  });

  it('draws a picture row as a tone at the right height', () => {
    const image = blank(20, 11);
    for (let x = 0; x < 20; x++) image.data[2 * 20 + x] = 1; // row 2 of 11
    const sound = imageToSound(image, { seconds: 1, minHz: 1000, maxHz: 6000, sampleRate: RATE });
    expect(sound.length).toBe(RATE);
    expect(Math.max(...sound.map(Math.abs))).toBeLessThanOrEqual(0.9);
    const spec = spectrogram(sound, RATE, { fftSize: 1024 });
    // Row 2 of 11 between 6000 and 1000 Hz: 5000 Hz. Rows run from 11025 Hz (top) to 0.
    const hz = spec.maxHz * (1 - (loudestRow(spec) + 0.5) / spec.height);
    expect(Math.abs(hz - 5000)).toBeLessThan(60);
  });

  it('keeps the picture in time: left half loud, right half quiet', () => {
    const image = blank(10, 5);
    for (let x = 0; x < 5; x++) image.data[2 * 10 + x] = 1;
    const sound = imageToSound(image, { seconds: 1, sampleRate: RATE, minHz: 500, maxHz: 8000 });
    const energy = (from: number, to: number) =>
      sound.slice(from, to).reduce((s, v) => s + v * v, 0);
    expect(energy(0, RATE / 2)).toBeGreaterThan(50 * energy(RATE / 2 + 2000, RATE));
  });

  it('turns pixels into brightness and colours', () => {
    const rgba = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 0]);
    const gray = toGray(rgba, 3, 1);
    expect(Array.from(gray.data)).toEqual([1, 0, 0]);
    const inverted = toGray(rgba, 3, 1, true).data;
    expect(inverted[0]).toBeCloseTo(0);
    expect(Array.from(inverted.subarray(1))).toEqual([1, 0]);
    expect(averageBrightness(gray)).toBeCloseTo(1 / 3);
    const spec = { width: 2, height: 1, data: new Float32Array([0, 1]), maxHz: 1, seconds: 1 };
    expect(Array.from(colorize(spec))).toEqual([0, 0, 4, 255, 252, 253, 191, 255]);
  });

  it('writes a WAV file', () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -1]), 8000);
    expect(parseWav(wav)).toMatchObject({
      channels: 1,
      sampleRate: 8000,
      bitsPerSample: 16,
      frames: 3,
    });
    expect(new DataView(wav.buffer).getInt16(48, true)).toBe(-32767);
  });

  it('copes with silence', () => {
    const spec = spectrogram(new Float32Array(5000), RATE);
    expect(spec.data.every((v) => v === 0)).toBe(true);
    expect(imageToSound(blank(4, 4), { seconds: 0.1 }).every((v) => v === 0)).toBe(true);
  });
});
