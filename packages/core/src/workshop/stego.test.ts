import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  StegoError,
  chiSquareProfile,
  chiSquareVerdict,
  decodeBmp,
  decodePng,
  decodeRaster,
  encodeBmp,
  encodePng,
  hideInRaster,
  looksExecutable,
  lsbPlane,
  peekHidden,
  revealFromRaster,
  stegoCapacity,
  type Raster,
} from './index';

/** A smooth picture with a little noise, like a photo. */
function photo(width: number, height: number, channels: 3 | 4 = 3): Raster {
  const data = new Uint8Array(width * height * channels);
  let seed = 7;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed >> 16) % 5;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * channels;
      data[p] = Math.min(255, Math.round((x / width) * 200) + noise());
      data[p + 1] = Math.min(255, Math.round((y / height) * 180) + noise());
      data[p + 2] = Math.min(255, 90 + noise() * 2);
      if (channels === 4) data[p + 3] = x < 4 ? 0 : 255;
    }
  }
  return { width, height, channels, data };
}

const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof StegoError ? e.code : String(e);
  }
};

describe('raster', () => {
  it('PNG and BMP come back bit for bit', () => {
    const rgb = photo(37, 21);
    expect(decodePng(encodePng(rgb))).toEqual(rgb);
    const rgba = photo(20, 9, 4);
    expect(decodeRaster(encodePng(rgba))).toEqual(rgba);
    expect(decodeBmp(encodeBmp(rgb))).toEqual(rgb);
    expect(decodeRaster(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe('steganography', () => {
  it('hides a text invisibly and reads it back from the PNG', async () => {
    const cover = photo(120, 80);
    const text = 'Treffpunkt: alte Eiche, 15 Uhr 🧙';
    const hidden = await hideInRaster(cover, { kind: 'text', text });
    // Every colour value differs by at most 1.
    expect(hidden.data.every((v, i) => Math.abs(v - (cover.data[i] ?? 0)) <= 1)).toBe(true);
    const back = decodePng(encodePng(hidden));
    expect(back && peekHidden(back)).toMatchObject({ encrypted: false, bits: 1 });
    expect(back && (await revealFromRaster(back))).toEqual({ kind: 'text', text });
    expect(peekHidden(cover)).toBeNull();
    expect(await code(() => revealFromRaster(cover))).toBe('nothing-hidden');
  });

  it('keeps files and protects them with a password', async () => {
    const cover = photo(100, 100, 4);
    const data = Uint8Array.from({ length: 1500 }, (_, i) => (i * 7) % 256);
    const hidden = await hideInRaster(
      cover,
      { kind: 'file', name: 'notizen.txt', data },
      { password: 'Abrakadabra', bits: 2 },
    );
    // Fully transparent pixels stay untouched.
    expect(hidden.data[3]).toBe(0);
    expect(hidden.data.subarray(0, 4)).toEqual(cover.data.subarray(0, 4));
    expect(peekHidden(hidden)).toMatchObject({ encrypted: true, bits: 2 });
    expect(await code(() => revealFromRaster(hidden))).toBe('needs-password');
    expect(await code(() => revealFromRaster(hidden, 'Hokuspokus'))).toBe('wrong-password');
    expect(await revealFromRaster(hidden, 'Abrakadabra')).toEqual({
      kind: 'file',
      name: 'notizen.txt',
      data,
    });
  });

  it('notices damage and too little room', async () => {
    const cover = photo(40, 40);
    const hidden = await hideInRaster(cover, { kind: 'text', text: 'Hallo Welt' });
    const broken = { ...hidden, data: hidden.data.slice() };
    for (let i = 120; i < 160; i++) broken.data[i] = (broken.data[i] ?? 0) ^ 1;
    expect(await code(() => revealFromRaster(broken))).toBe('damaged');
    const room = stegoCapacity(cover);
    expect(room).toBe(Math.floor((40 * 40 * 3 - 88) / 8) - 4);
    let seed = 99;
    const random = Uint8Array.from({ length: room + 50 }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed >> 23;
    });
    expect(
      await code(() => hideInRaster(cover, { kind: 'file', name: 'x.dat', data: random })),
    ).toBe('too-big');
  });

  it('refuses programs and scripts, also inside a ZIP', async () => {
    const cover = photo(200, 200);
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0]);
    expect(
      await code(() => hideInRaster(cover, { kind: 'file', name: 'bild.txt', data: exe })),
    ).toBe('executable');
    const script = new TextEncoder().encode('echo hi');
    expect(
      await code(() => hideInRaster(cover, { kind: 'file', name: 'a.ps1', data: script })),
    ).toBe('executable');
    const zip = zipSync({ 'ordner/tool.exe': new Uint8Array([1, 2, 3]) });
    expect(await code(() => hideInRaster(cover, { kind: 'file', name: 'a.zip', data: zip }))).toBe(
      'executable',
    );
    const fine = zipSync({ 'urlaub/foto.jpg': new Uint8Array([1, 2, 3]) });
    expect(
      await code(() => hideInRaster(cover, { kind: 'file', name: 'a.zip', data: fine })),
    ).toBeNull();
    expect(looksExecutable('foto.jpg.exe', new Uint8Array())).toBe(true);
    expect(looksExecutable('foto.jpg', new TextEncoder().encode('#!/bin/sh'))).toBe(true);
    expect(looksExecutable('brief.pdf', new TextEncoder().encode('%PDF-1.7'))).toBe(false);
  });

  it('the chi-square test sees where a message was written', async () => {
    const cover = photo(200, 200);
    const random = crypto.getRandomValues(new Uint8Array(4000));
    // Random content (like encrypted data) over about the first 25 % of the picture.
    const hidden = await hideInRaster(cover, { kind: 'file', name: 'r.bin', data: random });
    const before = chiSquareProfile(cover);
    const after = chiSquareProfile(hidden);
    expect(Math.max(...before.slice(0, 4))).toBeLessThan(0.5);
    // 4000 bytes ≈ 27 % of the colour values: the first strips light up, the rest stay calm.
    expect(Math.min(...after.slice(0, 4))).toBeGreaterThan(0.9);
    expect(Math.max(...after.slice(7))).toBeLessThan(0.5);
    expect(chiSquareVerdict(before)).toEqual({ kind: 'calm' });
    expect(chiSquareVerdict(after)).toMatchObject({ kind: 'suspicious' });
    expect(chiSquareVerdict([1, 1, 0.97, 0.9, 0.99, 0.8, 0.96, 0.7])).toEqual({ kind: 'unclear' });
    // A smooth sky at the top scores lower, the run still counts.
    expect(chiSquareVerdict([0.6, 0.92, 1, 1, 0.54, 0, 0, 0])).toEqual({
      kind: 'suspicious',
      percent: 63,
    });
    // A noisy picture without data: a short, weak run.
    expect(chiSquareVerdict([0.51, 0.64, 0.03, 0.73, 0.21, 0.34, 0.89, 0.53])).toEqual({
      kind: 'calm',
    });
    expect(chiSquareVerdict([1, 0.99, 0.2, 0.1, 0.6, 0.05, 0, 0.3])).toEqual({
      kind: 'suspicious',
      percent: 25,
    });
    const plane = lsbPlane(cover);
    expect(plane.length).toBe(200 * 200 * 4);
  });
});
