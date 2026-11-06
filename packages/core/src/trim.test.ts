import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs } from './ffmpeg-args';
import { findRoutes, listTargets, type RoutableEngine } from './router';
import { formatTimecode, parseTimecode, pickTrimOptions, readTrim, trimOptions } from './trim';

describe('trim options', () => {
  it('reads a part and ignores nonsense', () => {
    expect(readTrim({})).toBeNull();
    expect(readTrim({ trimStart: 0 })).toBeNull();
    expect(readTrim({ trimStart: 5, trimEnd: 12.5 })).toEqual({ start: 5, end: 12.5, fast: false });
    expect(readTrim({ trimEnd: 3, trimFast: true })).toEqual({ start: 0, end: 3, fast: true });
    // An end before the start means "to the end".
    expect(readTrim({ trimStart: 5, trimEnd: 2 })).toEqual({ start: 5, end: null, fast: false });
    expect(readTrim({ trimStart: -1, trimEnd: 'x' })).toBeNull();
  });

  it('writes and clears the option values', () => {
    expect(trimOptions({ start: 1.23456, end: 4, fast: true })).toEqual({
      trimStart: 1.235,
      trimEnd: 4,
      trimFast: true,
    });
    expect(trimOptions(null)).toEqual({
      trimStart: undefined,
      trimEnd: undefined,
      trimFast: undefined,
    });
    expect(pickTrimOptions({ quality: 5, trimStart: 2, trimFast: true })).toEqual({
      trimStart: 2,
      trimFast: true,
    });
  });

  it.each([
    [0, '0:00'],
    [75.5, '1:15.5'],
    [59.96, '1:00'],
    [3725, '1:02:05'],
  ])('formats %s seconds as %s', (seconds, text) => {
    expect(formatTimecode(seconds)).toBe(text);
  });

  it.each([
    ['1:15.5', 75.5],
    ['75,5', 75.5],
    ['1:02:05', 3725],
    ['0:07', 7],
    ['1:75', null],
    ['abc', null],
    ['', null],
  ])('reads %s', (text, seconds) => {
    expect(parseTimecode(text)).toBe(seconds);
  });
});

describe('cutting with ffmpeg', () => {
  const base = { input: 'in', output: 'out', target: 'native' as const };

  it('seeks before the input and limits the length', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'mp4',
      outputExt: 'webm',
      options: { trimStart: 5, trimEnd: 12.5 },
    });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-ss') + 1]).toBe('5');
    expect(args[args.indexOf('-t') + 1]).toBe('7.5');
    expect(args).toContain('libvpx-vp9');
  });

  it('copies the streams when cutting fast into the same format', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'mp4',
      outputExt: 'mp4',
      options: { trimEnd: 10, trimFast: true, removeAudio: true },
    });
    expect(args).toEqual(expect.arrayContaining(['-c', 'copy', '-an', '-t', '10']));
    expect(args).not.toContain('-ss');
    expect(args).not.toContain('libx264');
  });

  it('re-encodes when the format changes, even when "fast" is set', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'mov',
      outputExt: 'mp4',
      options: { trimStart: 1, trimFast: true },
    });
    expect(args).not.toContain('copy');
    expect(args).toContain('libx264');
  });

  it('copies only the sound for songs', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'mp3',
      outputExt: 'mp3',
      options: { trimStart: 30, trimFast: true },
    });
    expect(args).toEqual(expect.arrayContaining(['-map', '0:a:0', '-c', 'copy']));
  });

  it('makes animated WebP pictures', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'mp4',
      outputExt: 'webp',
      options: { fps: '10', videoQuality: 'small' },
    });
    expect(args).toEqual(
      expect.arrayContaining(['-c:v', 'libwebp_anim', '-quality', '50', '-loop', '0', '-an']),
    );
    expect(args.join(' ')).toContain('fps=10');
    expect(args.slice(-3)).toEqual(['-f', 'webp', 'out']);
  });
});

describe('routing when cutting', () => {
  const fmt = (ext: string) => ({ ext, canRead: true, canWrite: true });
  const media: RoutableEngine = {
    id: 'ffmpeg',
    runtime: 'browser',
    formats: [fmt('mp4'), fmt('webm'), fmt('gif'), fmt('mp3')],
    priority: 5,
    status: 'ready',
    supportsTrim: true,
  };
  const image: RoutableEngine = {
    id: 'vips',
    runtime: 'browser',
    formats: [fmt('gif'), fmt('png')],
    priority: 20,
    status: 'ready',
  };

  it('allows the same format and only engines that can cut', () => {
    expect(findRoutes([media, image], 'mp4', 'mp4', 'browser', { trim: true })).toEqual([
      {
        runtime: 'browser',
        steps: [{ engineId: 'ffmpeg', runtime: 'browser', from: 'mp4', to: 'mp4' }],
      },
    ]);
    // Without trimming there is no "MP4 → MP4".
    expect(findRoutes([media], 'mp4', 'mp4', 'browser')).toEqual([]);
    // No chain through another engine: mp4 → gif → png would lose the cut.
    expect(findRoutes([media, image], 'mp4', 'png', 'browser', { trim: true })).toEqual([]);
  });

  it('lists the own format first', () => {
    const targets = listTargets([media, image], 'mp4', ['browser'], { trim: true });
    expect(targets.map((t) => t.ext)).toEqual(['mp4', 'webm', 'gif', 'mp3']);
  });
});
