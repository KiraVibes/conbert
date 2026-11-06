import { describe, expect, it } from 'vitest';
import { bitratesForTarget, compressionOptions, findQualityForSize } from './compression';
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

describe('findQualityForSize', () => {
  // A fake encoder: size grows with quality.
  const encode = (q: number) => Promise.resolve({ q, size: q * 1000 });

  it('finds the highest quality that fits', async () => {
    const best = await findQualityForSize(encode, (r) => r.size, 61_500);
    expect(best.q).toBeLessThanOrEqual(61);
    expect(best.q).toBeGreaterThan(55);
  });

  it('returns the smallest attempt when nothing fits', async () => {
    const best = await findQualityForSize(encode, (r) => r.size, 100);
    expect(best.size).toBeLessThan(10_000);
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
