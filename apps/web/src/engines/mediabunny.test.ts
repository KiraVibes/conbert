// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { ConversionError, engineI18nKeys, getFormat } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import { convertWithMediabunny, mediabunnyOptions } from './mediabunny-convert';
import { MEDIABUNNY_FORMATS, MEDIABUNNY_META } from './mediabunny-definition';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(import.meta.dirname, '__fixtures__', name)));

async function inspect(data: Uint8Array) {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(data) });
  const format = await input.getFormat();
  const tracks = await input.getTracks();
  return { format: format.name, tracks: tracks.map((t) => t.type) };
}

describe('mediabunny definition', () => {
  it('has texts and registry entries for everything it declares', () => {
    expect(findMissingKeys(engineI18nKeys(MEDIABUNNY_META))).toEqual([]);
    for (const f of MEDIABUNNY_FORMATS) expect(getFormat(f.ext), f.ext).toBeDefined();
  });

  it('leaves out options WebCodecs ignores', () => {
    const keys = MEDIABUNNY_META.options.map((o) => o.key);
    expect(keys).not.toContain('useGpu');
    expect(keys).not.toContain('encoderSpeed');
    expect(keys).toContain('videoQuality');
  });
});

describe('mediabunnyOptions', () => {
  it('copies streams the container accepts and re-encodes only when needed', () => {
    const h264 = { video: 'avc', audio: 'aac' };
    const copy = mediabunnyOptions('mkv', {}, h264);
    expect(copy.video).not.toHaveProperty('quality');
    expect(copy.audio).not.toHaveProperty('quality');
    // "Small file", a fixed bitrate or a container that needs other codecs re-encode.
    expect(mediabunnyOptions('mkv', { videoQuality: 'small' }, h264).video).toHaveProperty(
      'quality',
    );
    expect(mediabunnyOptions('mkv', { audioBitrate: '128' }, h264).audio).toHaveProperty('quality');
    const webm = mediabunnyOptions('webm', {}, h264);
    expect(webm.video).toHaveProperty('quality');
    expect(webm.audio).toHaveProperty('quality');
  });

  it('maps size, frame rate, codec and audio removal', () => {
    const { video, audio } = mediabunnyOptions('mkv', {
      resolution: '720',
      fps: '30',
      videoCodec: 'h265',
      removeAudio: true,
    });
    expect(video).toMatchObject({ height: 720, fit: 'contain', frameRate: 30, codec: 'hevc' });
    expect(audio).toEqual({ discard: true });
  });

  it('drops video for audio targets and picks the codec the container needs', () => {
    const { video, audio } = mediabunnyOptions('ogg', { channels: 'mono', sampleRate: '44100' });
    expect(video).toEqual({ discard: true });
    expect(audio).toMatchObject({ codec: 'opus', numberOfChannels: 1, sampleRate: 44100 });
  });

  it('rejects formats it cannot write', () => {
    expect(() => mediabunnyOptions('avi', {})).toThrow(ConversionError);
  });
});

// Node has no WebCodecs: only copying and PCM work here, which is exactly
// what these tests cover. Encoding is covered by the browser E2E tests.
describe('convertWithMediabunny (stream copy)', () => {
  const noop = () => undefined;

  it('repackages MP4 as MOV without re-encoding', async () => {
    const out = await convertWithMediabunny(fixture('sample.mp4'), 'mp4', 'mov', {}, noop);
    const info = await inspect(out);
    expect(info.format.toLowerCase()).toContain('quicktime');
    expect(info.tracks).toEqual(['video', 'audio']);
  });

  it('extracts the audio track of a video', async () => {
    const out = await convertWithMediabunny(fixture('sample.mp4'), 'mp4', 'm4a', {}, noop);
    expect((await inspect(out)).tracks).toEqual(['audio']);
  });

  it('reports progress and writes WAV', async () => {
    const seen: number[] = [];
    const out = await convertWithMediabunny(fixture('sample.wav'), 'wav', 'wav', {}, (p) =>
      seen.push(p),
    );
    expect((await inspect(out)).format).toMatch(/wav/i);
    expect(seen.at(-1)).toBe(100);
  });

  it('cuts out a part: fast by copying, sound exactly', async () => {
    const length = async (data: Uint8Array) =>
      new Input({ formats: ALL_FORMATS, source: new BufferSource(data) }).computeDuration();
    const video = fixture('sample.mp4');
    const full = await length(video);
    const cut = await convertWithMediabunny(
      video,
      'mp4',
      'mp4',
      { trimEnd: full / 2, trimFast: true },
      noop,
    );
    // The tiny sample has B-frames: a copied cut may keep the frames they need.
    expect(await length(cut)).toBeLessThanOrEqual(full);
    expect((await inspect(cut)).tracks).toEqual(['video', 'audio']);
    // Sound packets are all key frames: that cut is exact.
    const sound = await convertWithMediabunny(
      video,
      'mp4',
      'm4a',
      { trimEnd: full / 2, trimFast: true },
      noop,
    );
    expect(await length(sound)).toBeLessThan(full * 0.7);

    const song = fixture('sample.wav');
    const songLength = await length(song);
    const part = await convertWithMediabunny(
      song,
      'wav',
      'wav',
      { trimStart: songLength / 4, trimEnd: songLength / 2 },
      noop,
    );
    expect(await length(part)).toBeCloseTo(songLength / 4, 1);
  });

  it('re-encodes the video for an exact cut', () => {
    const h264 = { video: 'avc', audio: 'aac' };
    expect(mediabunnyOptions('mp4', { trimStart: 2 }, h264).video).toHaveProperty('quality');
    expect(
      mediabunnyOptions('mp4', { trimStart: 2, trimFast: true }, h264).video,
    ).not.toHaveProperty('quality');
    // Cutting only the end needs no key frame.
    expect(mediabunnyOptions('mp4', { trimEnd: 2 }, h264).video).not.toHaveProperty('quality');
  });

  it('asks for the fallback when a codec is missing', async () => {
    // MP3 decoding needs WebCodecs, which Node lacks.
    await expect(
      convertWithMediabunny(fixture('sample.mp3'), 'mp3', 'wav', {}, noop),
    ).rejects.toMatchObject({ messageKey: 'errors.formatUnavailable' });
  });

  it('hands loudness and silence over to ffmpeg.wasm', async () => {
    for (const options of [{ loudness: 'music' }, { trimSilence: true }]) {
      await expect(
        convertWithMediabunny(fixture('sample.wav'), 'wav', 'wav', options, noop),
      ).rejects.toMatchObject({ messageKey: 'errors.formatUnavailable' });
    }
    // "Off" changes nothing: mediabunny does it itself.
    const out = await convertWithMediabunny(
      fixture('sample.wav'),
      'wav',
      'wav',
      { loudness: 'off', trimSilence: false },
      noop,
    );
    expect(out.byteLength).toBeGreaterThan(0);
  });
});
