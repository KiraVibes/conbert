import { deflateSync } from 'node:zlib';
import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { crc32 } from './crc';
import { recoverCroppedPng, readPngInfo } from './cropped-png';
import { inflateTail } from './inflate-tail';

function chunk(t: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = t.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function split(data: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) out.push(data.subarray(i, i + size));
  return out;
}

/** A PNG (RGB, 8 bit) whose rows use the "Sub" filter. */
function png(width: number, height: number, pixel: (x: number, y: number) => number[]) {
  const raw = new Uint8Array(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 1;
    let prev = [0, 0, 0];
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y);
      for (let c = 0; c < 3; c++) raw[o++] = ((p[c] ?? 0) - (prev[c] ?? 0)) & 255;
      prev = p;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    // Like libpng: the data in IDAT chunks of 8 KB.
    ...split(new Uint8Array(deflateSync(raw, { level: 6 })), 8192).map((d) => chunk('IDAT', d)),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

// Noise, so zlib writes several blocks and few back-references (very repetitive
// pictures keep copying the lost bytes, which then show up as magenta).
let seed = 7;
const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 24;
const W = 300;
const H = 400;
const picture = Array.from({ length: H }, () =>
  Array.from({ length: W }, () => [rand() & 63, rand() & 63, rand() & 63]),
);

describe('cropped PNG (aCropalypse)', () => {
  it('shows the lower part of the old picture again', { timeout: 30_000 }, () => {
    const original = png(W, H, (x, y) => picture[y]?.[x] ?? [0, 0, 0]);
    const cropped = png(120, 80, (x, y) => picture[y]?.[x] ?? [0, 0, 0]);
    // The cropping tool wrote the new file over the old one without cutting it short.
    const file = new Uint8Array(original);
    file.set(cropped);
    expect(readPngInfo(file)?.trailerAt).toBe(cropped.length);

    const r = recoverCroppedPng(file);
    expect(r.status).toBe('recovered');
    if (r.status !== 'recovered') return;
    expect(r.width).toBe(W);
    expect(r.height).toBeGreaterThan(H / 3);
    // The last rows are the old picture's last rows (where their bytes are known).
    const top = H - r.height;
    let same = 0;
    let checked = 0;
    for (let y = Math.floor(r.height / 2); y < r.height; y++) {
      for (let x = 0; x < W; x += 7) {
        const o = (y * W + x) * 4;
        const want = picture[top + y]?.[x] ?? [];
        checked++;
        if (r.pixels[o] === want[0] && r.pixels[o + 1] === want[1] && r.pixels[o + 2] === want[2])
          same++;
      }
    }
    expect(same / checked).toBeGreaterThan(0.9);
  });

  it('says so when there is nothing behind the end', () => {
    const clean = png(40, 30, (x, y) => [x, y, 0]);
    expect(recoverCroppedPng(clean).status).toBe('clean');
    expect(recoverCroppedPng(new Uint8Array([1, 2, 3])).status).toBe('not-png');
  });

  it('decodes a whole DEFLATE stream from the start', () => {
    const text = new TextEncoder().encode('hallo hallo hallo welt '.repeat(200));
    const z = zlibSync(text);
    const r = inflateTail(z.subarray(2), 0);
    expect(r && new TextDecoder().decode(r.data)).toBe(new TextDecoder().decode(text));
    expect(r?.bitsLeft).toBeLessThan(40);
  });
});
