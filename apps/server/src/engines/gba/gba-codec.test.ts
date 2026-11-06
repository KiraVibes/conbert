import { describe, expect, it } from 'vitest';
import { GBA_MAX_ROM_BYTES } from '@conbert/core';
import { GbaVideoEncoder, decodeRecords, FRAME_KEY, FRAME_UPDATE } from './codec';
import { lz77Compress, lz77Decompress } from './lz77';
import { buildLookup, buildPalette, quantize } from './palette';
import { GbaRomTooLargeError, buildRom, headerTitle } from './rom';

/** Gradient background with a red square moving to the right. */
function frame(width: number, height: number, t: number): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 3;
      const inSquare = x >= 10 + t * 4 && x < 30 + t * 4 && y >= 20 && y < 40;
      out[p] = inSquare ? 230 : (x * 2) & 255;
      out[p + 1] = inSquare ? 20 : (y * 3) & 255;
      out[p + 2] = inSquare ? 30 : 120;
    }
  }
  return out;
}

describe('lz77', () => {
  it('round-trips repetitive and random data in the BIOS format', () => {
    const repetitive = new Uint8Array(5000).map((_, i) => (i % 7) * 3);
    const random = new Uint8Array(3000).map(() => Math.floor(Math.random() * 256));
    for (const data of [repetitive, random, new Uint8Array(0), new Uint8Array([1, 2])]) {
      const packed = lz77Compress(data);
      expect(packed[0]).toBe(0x10);
      expect(packed.length % 4).toBe(0);
      expect(lz77Decompress(packed)).toEqual(data);
    }
    expect(lz77Compress(repetitive).length).toBeLessThan(repetitive.length / 5);
  });
});

describe('palette', () => {
  it('keeps index 0 black and maps colours closely', () => {
    const f = frame(64, 48, 0);
    const palette = buildPalette([f]);
    expect(palette.colors[0]).toBe(0);
    const indices = quantize(f, 64, 48, buildLookup(palette));
    let error = 0;
    for (let p = 0; p < 64 * 48; p++) {
      const k = indices[p] ?? 0;
      for (let c = 0; c < 3; c++)
        error += Math.abs((f[p * 3 + c] ?? 0) - (palette.rgb[k * 3 + c] ?? 0));
    }
    // Mean error per channel stays small (dithering adds a little noise).
    expect(error / (64 * 48 * 3)).toBeLessThan(8);
  });
});

describe('GbaVideoEncoder', () => {
  const settings = { width: 64, height: 48, blockThreshold: 48, maxGroupFrames: 30 };

  it('stores a keyframe, then only the blocks that changed', () => {
    const encoder = new GbaVideoEncoder(settings);
    const records = [0, 1, 2, 3].flatMap((t) => encoder.push(frame(64, 48, t)));
    records.push(...encoder.finish());
    expect(records.map((r) => r[4])).toEqual([FRAME_KEY, FRAME_UPDATE, FRAME_UPDATE, FRAME_UPDATE]);
    // Updates are much smaller than the keyframe.
    expect(records[1]?.length ?? 0).toBeLessThan((records[0]?.length ?? 0) / 2);

    const stream = new Uint8Array(records.reduce((s, r) => s + r.length, 0));
    let o = 0;
    for (const r of records) {
      stream.set(r, o);
      o += r.length;
    }
    const decoded = decodeRecords(stream, records.length, 64, 48);
    // The square has moved in the last decoded frame: pixel (24, 30) is red.
    const last = decoded[3];
    const k = last?.indices[30 * 64 + 24] ?? 0;
    const color = last?.palette[k] ?? 0;
    expect(color & 31).toBeGreaterThan(24); // red
    expect((color >> 10) & 31).toBeLessThan(8); // little blue
  });

  it('starts a new scene with a keyframe and palette on a cut', () => {
    const encoder = new GbaVideoEncoder(settings);
    const black = new Uint8Array(64 * 48 * 3);
    const white = new Uint8Array(64 * 48 * 3).fill(255);
    const records = [black, black, white].flatMap((f) => encoder.push(f));
    records.push(...encoder.finish());
    expect(records.map((r) => [r[4], r[5]])).toEqual([
      [FRAME_KEY, 1],
      [FRAME_UPDATE, 0],
      [FRAME_KEY, 1],
    ]);
  });
});

describe('buildRom', () => {
  const player = new Uint8Array(1000);

  it('appends the video behind the player and fixes the cartridge header', () => {
    const rom = buildRom({
      player,
      width: 160,
      height: 104,
      fps: 15,
      audioRate: 16384,
      audioTimerSteps: 1024,
      audio: new Uint8Array(100).fill(5),
      records: [new Uint8Array(8)],
      title: 'Mein Urlaub (2026)',
    });
    expect(new TextDecoder().decode(rom.subarray(1024, 1028))).toBe('CGBV');
    const view = new DataView(rom.buffer);
    expect(view.getInt16(1024 + 12, true)).toBe(171); // 160 px → 240 px
    expect(view.getInt32(1024 + 20, true)).toBe(-2 * 171); // centred
    expect(view.getUint32(1024 + 52, true)).toBe(65536 - 1024);
    expect(view.getUint16(1024 + 4, true)).toBe(2); // format version
    expect(new TextDecoder().decode(rom.subarray(0xa0, 0xac))).toBe('MEIN URLAUB ');
    let check = 0;
    for (let k = 0xa0; k <= 0xbc; k++) check = (check - (rom[k] ?? 0)) & 0xff;
    expect(rom[0xbd]).toBe((check - 0x19) & 0xff);
    const soundOffset = view.getUint32(1024 + 40, true);
    expect(rom[1024 + soundOffset]).toBe(5);
    expect((1024 + soundOffset) % 4).toBe(0);
  });

  it('refuses modules over 32 MB', () => {
    const big = new Uint8Array(GBA_MAX_ROM_BYTES);
    expect(() =>
      buildRom({
        player,
        width: 120,
        height: 80,
        fps: 15,
        audioRate: 16384,
        audioTimerSteps: 1024,
        audio: null,
        records: [big],
        title: 'x',
      }),
    ).toThrow(GbaRomTooLargeError);
  });

  it('makes a readable cartridge title', () => {
    expect(headerTitle('Ärger im Büro!.mp4')).toBe('ARGER IM BUR');
    expect(headerTitle('???')).toBe('CONBERT');
  });
});

describe('keyframe index', () => {
  it('lists every keyframe with its frame number and offset, and the loop flag', () => {
    const encoder = new GbaVideoEncoder({
      width: 64,
      height: 48,
      blockThreshold: 48,
      maxGroupFrames: 3,
    });
    const records = [0, 1, 2, 3, 4, 5, 6].flatMap((t) => encoder.push(frame(64, 48, t)));
    records.push(...encoder.finish());
    const rom = buildRom({
      player: new Uint8Array(300),
      width: 64,
      height: 48,
      fps: 15,
      audioRate: 16384,
      audioTimerSteps: 1024,
      audio: null,
      records,
      title: 'x',
      loop: true,
    });
    const view = new DataView(rom.buffer);
    const base = 512;
    expect(view.getUint16(base + 6, true) & 2).toBe(2);
    const indexOffset = view.getUint32(base + 56, true);
    const count = view.getUint32(base + 60, true);
    // Groups of 3 frames: keyframes at 0, 3 and 6.
    const entries = Array.from({ length: count }, (_, k) => ({
      frame: view.getUint32(base + indexOffset + k * 8, true),
      offset: view.getUint32(base + indexOffset + k * 8 + 4, true),
    }));
    expect(entries.map((e) => e.frame)).toEqual([0, 3, 6]);
    for (const e of entries) expect(rom[base + e.offset + 4]).toBe(FRAME_KEY);
  });
});
