import { describe, expect, it } from 'vitest';
import {
  testFileChunks,
  testFileName,
  testImagePixels,
  testSizeBytes,
  testToneChannels,
} from './test-files';

const total = (chunks: Iterable<Uint8Array>) => [...chunks].reduce((n, c) => n + c.length, 0);

describe('test files', () => {
  it('counts sizes in binary units and refuses nonsense', () => {
    expect(testSizeBytes(1, 'KB')).toBe(1024);
    expect(testSizeBytes(2.5, 'MB')).toBe(2.5 * 1024 * 1024);
    expect(testSizeBytes(0, 'MB')).toBeNull();
    expect(testSizeBytes(5, 'GB')).toBeNull();
  });

  it('makes files of exactly the asked size', () => {
    for (const fill of ['zeros', 'random', 'text'] as const) {
      expect(total(testFileChunks(3 * 1024 * 1024 + 7, fill))).toBe(3 * 1024 * 1024 + 7);
      expect(total(testFileChunks(1, fill))).toBe(1);
    }
  });

  it('fills random files with fresh data in every piece', () => {
    const [a = new Uint8Array(), b = new Uint8Array()] = [
      ...testFileChunks(2 * 1024 * 1024, 'random'),
    ];
    expect(a.length).toBe(1024 * 1024);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(a.some((x) => x !== 0)).toBe(true);
  });

  it('writes readable numbered lines into text files', () => {
    const [first] = [...testFileChunks(200, 'text')];
    expect(new TextDecoder().decode(first)).toMatch(/^Conbert test file - line 000000001/);
  });

  it('names files after size and content', () => {
    expect(testFileName(2.5, 'MB', 'random', '.ZIP')).toBe('test-2,5MB-random.zip');
    expect(testFileName(1, 'GB', 'zeros', '')).toBe('test-1GB-zeros.bin');
  });

  it('makes tones of the asked length, the stereo test alternating sides', () => {
    const [l, r] = testToneChannels('stereo', 2, 1000);
    expect(l.length).toBe(2000);
    expect(Math.max(...l.slice(0, 1000).map(Math.abs))).toBeGreaterThan(0.3);
    expect(Math.max(...r.slice(0, 1000).map(Math.abs))).toBe(0);
    expect(Math.max(...r.slice(1000).map(Math.abs))).toBeGreaterThan(0.3);
    const [beeps] = testToneChannels('beeps', 1, 1000);
    expect(Math.max(...beeps.slice(200).map(Math.abs))).toBe(0);
  });

  it('draws a test picture with a red border and colour bars', () => {
    const px = testImagePixels(70, 50);
    expect(px.length).toBe(70 * 50 * 4);
    expect([...px.slice(0, 3)]).toEqual([255, 0, 0]);
    const inBar = (10 * 70 + 5) * 4; // first bar: white
    expect(px[inBar]).toBe(235);
    expect(px[inBar + 2]).toBe(235);
  });
});
