import { describe, expect, it } from 'vitest';
import {
  assembleCarrier,
  blockLevels,
  frameBlocks,
  frameCapacity,
  readFrameBlocks,
  splitForCarrier,
  type FrameLayout,
} from './data-carriers';

const enc = (s: string) => new TextEncoder().encode(s);
const file = {
  name: 'geheim.txt',
  bytes: enc('Das ist ein geheimer Schlüssel: 12345 '.repeat(40)),
};

describe('pieces', () => {
  it('splits and puts back together in any order', () => {
    const pieces = splitForCarrier(
      { name: file.name, bytes: crypto.getRandomValues(new Uint8Array(3000)) },
      300,
    );
    expect(pieces.length).toBeGreaterThan(5);
    const shuffled = [...pieces].reverse();
    shuffled.push(pieces[2] ?? new Uint8Array());
    const r = assembleCarrier(shuffled);
    expect(r.ok).toBe(true);
  });

  it('names missing pieces and refuses broken ones', () => {
    const pieces = splitForCarrier(
      { name: 'x.bin', bytes: crypto.getRandomValues(new Uint8Array(2000)) },
      200,
    );
    const r = assembleCarrier(pieces.filter((_, i) => i !== 1 && i !== 4));
    expect(r).toMatchObject({ ok: false, reason: 'missing', missing: [1, 4] });
    const broken = pieces.map((p) => p.slice());
    const last = broken.at(-1);
    if (last) last[last.length - 1] = (last[last.length - 1] ?? 0) ^ 0xff;
    expect(assembleCarrier(broken)).toMatchObject({ ok: false, reason: 'broken' });
    expect(assembleCarrier([enc('hello')])).toMatchObject({ ok: false, reason: 'none' });
  });

  it('keeps the file name and content', () => {
    const r = assembleCarrier(splitForCarrier(file, 120));
    expect(r.ok && r.file.name).toBe('geheim.txt');
    expect(r.ok && new TextDecoder().decode(r.file.bytes)).toBe(
      new TextDecoder().decode(file.bytes),
    );
  });
});

describe('video frames', () => {
  const layout: FrameLayout = { width: 320, height: 240, block: 8 };

  function render(blocks: Uint8Array, noise: number): Uint8ClampedArray {
    const px = new Uint8ClampedArray(layout.width * layout.height * 4);
    const cols = layout.width / layout.block;
    for (let y = 0; y < layout.height; y++)
      for (let x = 0; x < layout.width; x++) {
        const b = blocks[Math.floor(y / layout.block) * cols + Math.floor(x / layout.block)] ?? 0;
        const v = (b ? 235 : 20) + (Math.random() - 0.5) * noise;
        px.set([v, v, v, 255], (y * layout.width + x) * 4);
      }
    return px;
  }

  it('carries a piece through a noisy frame', () => {
    const piece = crypto.getRandomValues(new Uint8Array(frameCapacity(layout)));
    const px = render(frameBlocks(piece, layout), 120);
    expect(readFrameBlocks(blockLevels(px, layout.width, layout), layout)).toEqual(piece);
  });

  it('refuses a frame without the pattern', () => {
    const px = new Uint8ClampedArray(layout.width * layout.height * 4).fill(128);
    expect(readFrameBlocks(blockLevels(px, layout.width, layout), layout)).toBeNull();
  });
});
