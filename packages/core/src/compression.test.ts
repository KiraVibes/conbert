import { describe, expect, it } from 'vitest';
import {
  bitratesForTarget,
  compressLevels,
  compressionOptions,
  compressToSize,
  sizeLadder,
  targetPrecision,
} from './compression';
import { buildFfmpegArgs } from './ffmpeg-args';
import { decideRoute, findRoutes, type RoutableEngine } from './router';

describe('bitratesForTarget', () => {
  it('splits a size budget between picture and sound', () => {
    // 10 MB for 100 s ≈ 800 kbit/s in total, minus a little slack.
    const rates = bitratesForTarget(10_000_000, 100, true);
    expect(rates.audioKbps).toBe(96);
    expect(rates.videoKbps + rates.audioKbps).toBeLessThanOrEqual(800);
    expect(rates.videoKbps).toBeGreaterThan(600);
  });

  it('gives audio-only files all of it, within sane limits', () => {
    expect(bitratesForTarget(1_000_000, 60, false).audioKbps).toBe(123);
    expect(bitratesForTarget(100_000_000, 60, false).audioKbps).toBe(320);
    expect(bitratesForTarget(10_000, 600, false).audioKbps).toBe(32);
  });
});

describe('compressionOptions', () => {
  it('maps levels to picture settings and keeps metadata stripping', () => {
    expect(compressionOptions('jpg', { level: 'max', stripMetadata: true })).toMatchObject({
      quality: 90,
      stripMetadata: true,
      forceReencode: true,
    });
    expect(compressionOptions('png', { level: 'small', stripMetadata: false })).toMatchObject({
      pngPalette: true,
      stripMetadata: false,
    });
  });

  it('maps levels to video and audio settings', () => {
    expect(compressionOptions('mp4', { level: 'small', stripMetadata: true })).toMatchObject({
      videoQuality: 'small',
      resolution: '720',
      audioBitrate: '96',
    });
    expect(
      compressionOptions('mp3', { level: 'target', targetBytes: 5_000_000, stripMetadata: true }),
    ).toMatchObject({ targetBytes: 5_000_000, audioQuality: 'balanced' });
  });
});

describe('compressToSize', () => {
  type Out = { o: Record<string, unknown>; size: number };
  const search = (
    outputExt: string,
    targetBytes: number,
    sizeFor: (o: Record<string, unknown>) => number,
  ) => {
    const tries: Record<string, unknown>[] = [];
    const result = compressToSize<Out>({
      outputExt,
      targetBytes,
      encode: (o) => {
        tries.push(o);
        return Promise.resolve({ o, size: sizeFor(o) });
      },
      sizeOf: (r) => r.size,
    });
    return { result, tries };
  };
  // A fake picture encoder: size grows with quality and with the pixel count.
  const picture = (o: Record<string, unknown>) => {
    const quality = Number(o['quality'] ?? 80);
    const scale = Number(o['scalePercent'] ?? 100) / 100;
    return Math.round(quality * 10_000 * scale * scale);
  };

  it('finds the highest picture quality that fits', async () => {
    const { result } = search('jpg', 615_000, picture);
    const best = await result;
    expect(best.size).toBeLessThanOrEqual(615_000);
    expect(best.o['quality']).toBeGreaterThan(55);
    expect(best.o['scalePercent']).toBeUndefined();
  });

  it('shrinks the picture when even the lowest quality is too big', async () => {
    // Quality 5 still gives 50 000 bytes – only fewer pixels help.
    const { result } = search('jpg', 20_000, picture);
    const best = await result;
    expect(best.size).toBeLessThanOrEqual(20_000);
    expect(best.size).toBeGreaterThan(20_000 * 0.85);
    expect(best.o['scalePercent']).toBeLessThan(100);
    expect(best.o['quality']).toBe(60);
  });

  it('shrinks lossless pictures right away (no quality search)', async () => {
    const { result, tries } = search('png', 200_000, picture);
    const best = await result;
    expect(tries[0]).toEqual({});
    expect(tries.some((t) => 'quality' in t)).toBe(false);
    expect(best.size).toBeLessThanOrEqual(200_000);
    expect(best.size).toBeGreaterThan(200_000 * 0.85);
  });

  it('corrects a video that came out too big', async () => {
    // The encoder overshoots its aim by 10 %.
    const video = (o: Record<string, unknown>) =>
      Math.round(Number(o['targetBytes'] ?? 10_000_000) * 1.1);
    const { result, tries } = search('mp4', 10_000_000, video);
    const best = await result;
    expect(tries).toHaveLength(2);
    expect(best.size).toBeLessThanOrEqual(10_000_000);
    expect(best.size).toBeGreaterThan(9_500_000);
  });

  it('does not encode a video again when it already fits', async () => {
    const { result, tries } = search('mp4', 10_000_000, () => 9_300_000);
    expect((await result).size).toBe(9_300_000);
    expect(tries).toHaveLength(1);
  });

  it('stops when the bitrate cannot go lower', async () => {
    const { result, tries } = search('mp3', 1_000, () => 50_000);
    expect((await result).size).toBe(50_000);
    expect(tries).toHaveLength(2);
  });

  it('takes the best level that fits for formats without exact control', async () => {
    const sizes: Record<string, number> = { lossless: 900, ebook: 500, screen: 200 };
    const pdf = (o: Record<string, unknown>) => sizes[String(o['pdfQuality'])] ?? 0;
    const fits = search('pdf', 600, pdf);
    expect((await fits.result).o['pdfQuality']).toBe('ebook');
    expect(fits.tries).toHaveLength(2);
    // Nothing fits: the smallest level.
    const missed = search('pdf', 100, pdf);
    expect((await missed.result).o['pdfQuality']).toBe('screen');
  });
});

describe('target size per category', () => {
  it('is offered everywhere, exact only for pictures, video and sound', () => {
    expect(compressLevels('pdf')).toContain('target');
    expect(compressLevels('3d')).toContain('target');
    expect(targetPrecision('image')).toBe('exact');
    expect(targetPrecision('audio')).toBe('exact');
    expect(targetPrecision('pdf')).toBe('levels');
    expect(targetPrecision('archive')).toBe('levels');
  });

  it('lists each real level once, best first', () => {
    expect(sizeLadder('pdf').map((o) => o['pdfQuality'])).toEqual(['lossless', 'ebook', 'screen']);
    expect(sizeLadder('woff2').map((o) => o['fontSubset'])).toEqual(['all', 'latin-ext']);
    expect(sizeLadder('7z')).toHaveLength(1);
  });
});

describe('compressing in the router', () => {
  const vips: RoutableEngine & { supportsCompression: boolean } = {
    id: 'vips',
    runtime: 'browser',
    priority: 20,
    status: 'ready',
    supportsCompression: true,
    formats: ['png', 'jpg'].map((ext) => ({ ext, canRead: true, canWrite: true })),
  };
  const noCompression = { ...vips, id: 'other', supportsCompression: false };

  it('allows the same format only when compressing, with engines that can', () => {
    expect(findRoutes([vips], 'png', 'png', 'browser')).toEqual([]);
    const routes = findRoutes([vips, noCompression], 'png', 'png', 'browser', { compress: true });
    expect(routes.map((r) => r.steps[0]?.engineId)).toEqual(['vips']);
    const decision = decideRoute([vips], 'jpg', 'jpg', {
      mode: 'auto',
      fileSize: 100,
      serverAvailable: false,
      compress: true,
    });
    expect(decision.route?.steps[0]?.to).toBe('jpg');
  });
});

describe('ffmpeg with a target size', () => {
  it('uses an average bitrate instead of constant quality', () => {
    const args = buildFfmpegArgs({
      input: 'in',
      inputExt: 'mp4',
      output: 'out',
      outputExt: 'mp4',
      options: { targetBytes: 10_000_000, durationSeconds: 100 },
    });
    expect(args).not.toContain('-crf');
    const b = args[args.indexOf('-b:v') + 1];
    expect(Number(b?.replace('k', ''))).toBeGreaterThan(600);
    expect(args[args.indexOf('-b:a') + 1]).toBe('96k');
  });

  it('keeps constant quality without a length', () => {
    const args = buildFfmpegArgs({
      input: 'in',
      inputExt: 'mp4',
      output: 'out',
      outputExt: 'mp4',
      options: { targetBytes: 10_000_000 },
    });
    expect(args).toContain('-crf');
  });
});
