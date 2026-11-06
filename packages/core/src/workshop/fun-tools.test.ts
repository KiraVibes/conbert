import { describe, expect, it } from 'vitest';
import { EMOJI_SET_IDS, averageColor, emojiMosaic, emojisOf, mosaicText } from './emoji-mosaic';
import type { Pixels } from './fun-image';
import {
  RINGTONE_MAX_SECONDS,
  applyFades,
  clampPart,
  cutChannels,
  encodeWavChannels,
  normalizePeak,
  waveformPeaks,
} from './ringtone';
import { joinPlan, megabytes, parsePartName, partName, splitPlan } from './split-join';
import { parseWav } from './wav';

const MB = 1024 * 1024;

describe('file splitter and joiner', () => {
  it('cuts a file into numbered parts like 7-Zip', () => {
    const plan = splitPlan('film.mp4', 25 * MB + 5, megabytes(10));
    expect(plan?.map((p) => p.name)).toEqual(['film.mp4.001', 'film.mp4.002', 'film.mp4.003']);
    expect(plan?.[2]).toMatchObject({ start: 20 * MB, end: 25 * MB + 5 });
    expect(plan?.reduce((n, p) => n + p.end - p.start, 0)).toBe(25 * MB + 5);
    // More than 999 parts are not possible.
    expect(splitPlan('a', 1000 * MB, MB)).toBeNull();
    expect(partName('x', 12)).toBe('x.012');
  });

  it('reads part names', () => {
    expect(parsePartName('film.mp4.002')).toEqual({ base: 'film.mp4', number: 2 });
    expect(parsePartName('film.mp4')).toBeNull();
    expect(parsePartName('film.000')).toBeNull();
  });

  it('puts parts in order and finds missing ones', () => {
    const part = (name: string, size = 10) => ({ name, size });
    const name = (p: { name: string }) => p.name;
    const size = (p: { size: number }) => p.size;
    const ok = joinPlan([part('a.zip.003', 4), part('a.zip.001'), part('a.zip.002')], name, size);
    expect(ok.ok && ok.plan.parts.map(name)).toEqual(['a.zip.001', 'a.zip.002', 'a.zip.003']);
    expect(ok.ok && ok.plan).toMatchObject({ name: 'a.zip', maybeIncomplete: false });
    // Last part as big as the others: maybe there are more.
    const full = joinPlan([part('a.001'), part('a.002')], name, size);
    expect(full.ok && full.plan.maybeIncomplete).toBe(true);
    expect(joinPlan([part('a.001'), part('a.003')], name, size)).toEqual({
      ok: false,
      problem: { kind: 'missing', numbers: [2] },
    });
    expect(joinPlan([part('a.002')], name, size)).toEqual({
      ok: false,
      problem: { kind: 'missing', numbers: [1] },
    });
    expect(joinPlan([part('a.001'), part('b.002')], name, size)).toMatchObject({
      ok: false,
      problem: { kind: 'mixed' },
    });
    expect(joinPlan([part('a.001'), part('a.001')], name, size)).toMatchObject({
      ok: false,
      problem: { kind: 'duplicate', number: 1 },
    });
    expect(joinPlan([part('a.txt')], name, size)).toEqual({
      ok: false,
      problem: { kind: 'notParts' },
    });
  });
});

/** Top half red, bottom half blue, the right quarter see-through. */
function picture(width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = y < height / 2 ? 230 : 10;
      data[i + 2] = y < height / 2 ? 20 : 220;
      data[i + 3] = x >= (width * 3) / 4 ? 0 : 255;
    }
  }
  return { width, height, data };
}

describe('emoji mosaic', () => {
  it('picks the emoji with the closest colour per square', () => {
    const emojis = ['🟥', '🟦', '⬜'];
    const colors = [
      [220, 30, 30],
      [30, 60, 220],
      [240, 240, 240],
    ] as const;
    const mosaic = emojiMosaic(picture(40, 20), 4, colors);
    expect(mosaic).toMatchObject({ columns: 4, rows: 2 });
    expect(mosaicText(mosaic, emojis)).toBe('🟥🟥🟥\n🟦🟦🟦');
  });

  it('measures a drawn emoji and skips empty drawings', () => {
    expect(averageColor([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0])).toEqual([128, 0, 128]);
    expect(averageColor([0, 0, 0, 0])).toBeNull();
  });

  it('has emojis in every set, the mix without doubles', () => {
    for (const id of EMOJI_SET_IDS) expect(emojisOf(id).length).toBeGreaterThan(10);
    const mix = emojisOf('mix');
    expect(new Set(mix).size).toBe(mix.length);
  });
});

describe('ringtone maker', () => {
  it('keeps the part inside the song and short enough for an iPhone', () => {
    expect(clampPart(10, 80, 200)).toEqual({ start: 10, end: 10 + RINGTONE_MAX_SECONDS });
    expect(clampPart(-5, 20, 200)).toEqual({ start: 0, end: 20 });
    expect(clampPart(190, 230, 200)).toEqual({ start: 190, end: 200 });
    expect(clampPart(5, 5, 3)).toEqual({ start: 2, end: 3 });
  });

  it('cuts, fades and makes it louder', () => {
    const rate = 100;
    const ch = new Float32Array(1000).fill(0.25);
    const [part] = cutChannels([ch], rate, 2, 4);
    expect(part?.length).toBe(200);
    if (!part) throw new Error('no part');
    applyFades([part], rate, 1, 0.5);
    expect(part[0]).toBe(0);
    expect(part[150]).toBeCloseTo(0.25);
    expect(part[199]).toBeCloseTo(0, 1);
    const factor = normalizePeak([part], -1);
    expect(factor).toBeGreaterThan(3);
    expect(Math.max(...part)).toBeCloseTo(10 ** (-1 / 20), 3);
    expect(normalizePeak([new Float32Array(10)])).toBe(1);
  });

  it('writes a stereo WAV the parser reads back', () => {
    const left = new Float32Array([0, 0.5, -0.5]);
    const right = new Float32Array([1, -1, 0]);
    const info = parseWav(encodeWavChannels([left, right], 44_100));
    expect(info).toMatchObject({ channels: 2, sampleRate: 44_100, bitsPerSample: 16 });
  });

  it('draws the loudness outline', () => {
    const ch = new Float32Array(100);
    ch[75] = -0.8;
    const peaks = waveformPeaks([ch], 4);
    expect([...peaks].map((p) => Math.round(p * 10) / 10)).toEqual([0, 0, 0, 0.8]);
  });
});

describe('crop box for workflows', () => {
  it('keeps as much of the picture as the shape allows', async () => {
    const { cropBox } = await import('../workflow');
    expect(cropBox(4000, 3000, '1:1')).toEqual({ width: 3000, height: 3000 });
    expect(cropBox(4000, 3000, '16:9')).toEqual({ width: 4000, height: 2250 });
    expect(cropBox(1080, 1920, '4:5')).toEqual({ width: 1080, height: 1350 });
    expect(cropBox(100, 100, 'wide')).toBeNull();
  });
});
