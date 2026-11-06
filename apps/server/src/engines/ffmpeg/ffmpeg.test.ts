import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getFormat } from '@conbert/core';
import { runProcess } from '../../lib/run-process';
import { hasCommand } from '../../test/helpers';
import { buildFfmpegArgs, parseProgressSeconds, pickVideoCodec } from '@conbert/core';
import { ffmpegAudioEngine, ffmpegVideoEngine, getHardwareInfo } from './index';
import { resolveMediaOptions } from '@conbert/core';

const fixtures = path.join(import.meta.dirname, '../../__fixtures__');
const base = { input: '/in/file', output: '/out/file', options: {} };

describe('ffmpeg arguments', () => {
  it('always forces the demuxer and allows only local files', () => {
    const args = buildFfmpegArgs({ ...base, inputExt: 'mp4', outputExt: 'webm' });
    const i = args.indexOf('-i');
    expect(args.slice(i - 4, i + 2)).toEqual([
      '-protocol_whitelist',
      'file',
      '-f',
      'mov',
      '-i',
      '/in/file',
    ]);
    expect(args.at(-1)).toBe('/out/file');
    expect(args.slice(-3, -1)).toEqual(['-f', 'webm']);
  });

  it('uses H.264 + AAC with fast start for MP4', () => {
    const args = buildFfmpegArgs({ ...base, inputExt: 'mov', outputExt: 'mp4' });
    expect(args).toEqual(
      expect.arrayContaining([
        '-c:v',
        'libx264',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
      ]),
    );
  });

  it('respects quality, speed and codec choices', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'mkv',
      outputExt: 'mp4',
      options: { videoQuality: 'high', encoderSpeed: 'small', videoCodec: 'h265' },
    });
    expect(args).toEqual(
      expect.arrayContaining([
        '-c:v',
        'libx265',
        '-crf',
        '20',
        '-preset',
        'slow',
        '-tag:v',
        'hvc1',
      ]),
    );
  });

  it('never puts H.264 into WebM', () => {
    const o = resolveMediaOptions({ videoCodec: 'h264' });
    expect(pickVideoCodec('webm', o)).toBe('libvpx-vp9');
    expect(pickVideoCodec('mp4', resolveMediaOptions({ videoCodec: 'vp9' }))).toBe('libx264');
  });

  it('scales down without ever upscaling and keeps the aspect ratio', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'mp4',
      outputExt: 'mp4',
      options: { resolution: '720', fps: '30' },
    });
    const vf = args[args.indexOf('-vf') + 1];
    expect(vf).toBe("scale=-2:'min(ih,720)',fps=30,format=yuv420p");
  });

  it('uses the GPU encoder when one was detected', () => {
    const nvenc = buildFfmpegArgs({ ...base, inputExt: 'mp4', outputExt: 'mp4', gpu: 'nvenc' });
    expect(nvenc).toEqual(expect.arrayContaining(['-c:v', 'h264_nvenc']));
    const vaapi = buildFfmpegArgs({ ...base, inputExt: 'mp4', outputExt: 'mkv', gpu: 'vaapi' });
    expect(vaapi.slice(0, vaapi.indexOf('-i'))).toEqual(
      expect.arrayContaining(['-vaapi_device', '/dev/dri/renderD128']),
    );
    expect(vaapi).toEqual(expect.arrayContaining(['-c:v', 'h264_vaapi']));
    const off = buildFfmpegArgs({
      ...base,
      inputExt: 'mp4',
      outputExt: 'mp4',
      gpu: 'nvenc',
      options: { useGpu: false },
    });
    expect(off).toEqual(expect.arrayContaining(['-c:v', 'libx264']));
    // VP9 has no NVENC encoder – stays in software.
    expect(buildFfmpegArgs({ ...base, inputExt: 'mp4', outputExt: 'webm', gpu: 'nvenc' })).toEqual(
      expect.arrayContaining(['-c:v', 'libvpx-vp9']),
    );
  });

  it('extracts only the sound for audio targets', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'mp4',
      outputExt: 'mp3',
      options: { audioQuality: 'high' },
    });
    expect(args).toEqual(expect.arrayContaining(['-vn', '-c:a', 'libmp3lame', '-q:a', '0']));
  });

  it('uses a fixed bitrate when one is chosen, mono and sample rate on request', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'wav',
      outputExt: 'm4a',
      options: { audioBitrate: '192', channels: 'mono', sampleRate: '44100' },
    });
    expect(args).toEqual(
      expect.arrayContaining(['-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '1']),
    );
  });

  it('strips metadata from videos but keeps music tags', () => {
    const value = (a: string[]) => a[a.indexOf('-map_metadata') + 1];
    expect(value(buildFfmpegArgs({ ...base, inputExt: 'mov', outputExt: 'mp4' }))).toBe('-1');
    expect(value(buildFfmpegArgs({ ...base, inputExt: 'mov', outputExt: 'mp3' }))).toBe('-1');
    expect(value(buildFfmpegArgs({ ...base, inputExt: 'flac', outputExt: 'mp3' }))).toBe('0');
  });

  it('makes GIFs with a palette, 12 fps and at most 480 px by default', () => {
    const args = buildFfmpegArgs({ ...base, inputExt: 'mp4', outputExt: 'gif' });
    const graph = args[args.indexOf('-filter_complex') + 1] ?? '';
    expect(graph).toContain('fps=12');
    expect(graph).toContain('min(ih,480)');
    expect(graph).toContain('palettegen');
  });

  it('refuses formats it does not know', () => {
    expect(() => buildFfmpegArgs({ ...base, inputExt: 'png', outputExt: 'mp4' })).toThrow();
  });

  it('parses progress output', () => {
    expect(
      parseProgressSeconds('frame=10\nout_time_us=1500000\nout_time_us=2500000\nprogress=continue'),
    ).toBe(2.5);
    expect(parseProgressSeconds('progress=continue')).toBeNull();
  });
});

const installed = hasCommand('ffmpeg') && hasCommand('ffprobe');

describe.skipIf(!installed)('ffmpeg conversions (real)', () => {
  let workDir: string;
  beforeAll(async () => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-ffmpeg-'));
    await ffmpegAudioEngine.init();
  });
  afterAll(() => rmSync(workDir, { recursive: true, force: true }));

  const audioIn = ['wav', 'mp3', 'flac', 'ogg', 'opus', 'm4a'];
  const audioOut = ffmpegAudioEngine.formats.filter((f) => f.canWrite).map((f) => f.ext);
  for (const from of audioIn) {
    for (const to of audioOut) {
      if (from === to) continue;
      it(`audio ${from} → ${to}`, async () => {
        const out = String(
          await ffmpegAudioEngine.convert({
            input: path.join(fixtures, `sample.${from}`),
            inputExt: from,
            outputExt: to,
            options: {},
            workDir,
          }),
        );
        const { stdout } = await runProcess('ffprobe', [
          '-v',
          'error',
          '-select_streams',
          'a:0',
          '-show_entries',
          'stream=codec_type',
          '-of',
          'csv=p=0',
          out,
        ]);
        expect(stdout.trim()).toBe('audio');
      });
    }
  }

  const videoIn = ['mp4', 'webm', 'mkv'];
  const videoOut = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'mpg', 'gif', 'mp3', 'm4a'];
  for (const from of videoIn) {
    for (const to of videoOut) {
      if (from === to) continue;
      it(`video ${from} → ${to}`, async () => {
        const progress: number[] = [];
        const out = String(
          await ffmpegVideoEngine.convert({
            input: path.join(fixtures, `sample.${from}`),
            inputExt: from,
            outputExt: to,
            options: { encoderSpeed: 'fast' },
            workDir,
            onProgress: (p) => progress.push(p.percent),
          }),
        );
        const type = await fileTypeFromFile(out);
        if (type) expect(getFormat(type.ext)?.category).toBe(getFormat(to)?.category ?? 'image');
        expect(progress.at(-1)).toBe(100);
      }, 60_000);
    }
  }

  const lengthOf = async (file: string) => {
    const { stdout } = await runProcess('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      file,
    ]);
    return Number(stdout.trim());
  };

  it.each([
    ['exact', false],
    ['fast (stream copy)', true],
  ])(
    'cuts a part out of a video, %s',
    async (_, fast) => {
      const input = path.join(fixtures, 'sample.mp4');
      const full = await lengthOf(input);
      const out = String(
        await ffmpegVideoEngine.convert({
          input,
          inputExt: 'mp4',
          outputExt: 'mp4',
          options: { trimStart: full / 4, trimEnd: full * 0.75, trimFast: fast },
          workDir,
        }),
      );
      // A copied cut keeps the frames its first pictures depend on – a little extra is fine.
      expect(await lengthOf(out)).toBeLessThanOrEqual(full + 0.1);
      expect(await lengthOf(out)).toBeGreaterThan(0);
    },
    60_000,
  );

  it('cuts songs exactly', async () => {
    const input = path.join(fixtures, 'sample.wav');
    const full = await lengthOf(input);
    const out = String(
      await ffmpegAudioEngine.convert({
        input,
        inputExt: 'wav',
        // FLAC: ffprobe knows its exact length (MP3 lengths are estimates).
        outputExt: 'flac',
        options: { trimStart: full / 4, trimEnd: full / 2 },
        workDir,
      }),
    );
    expect(await lengthOf(out)).toBeCloseTo(full / 4, 1);
  });

  /** A test sound made by ffmpeg itself (lavfi). */
  async function makeSound(name: string, source: string, filters?: string): Promise<string> {
    const file = path.join(workDir, name);
    await runProcess('ffmpeg', [
      '-hide_banner',
      '-y',
      '-f',
      'lavfi',
      '-i',
      source,
      ...(filters ? ['-af', filters] : []),
      file,
    ]);
    return file;
  }

  it('removes silence at the start and end, but keeps the sound', async () => {
    // 1 s silence, 1 s tone, 1.5 s silence.
    const input = await makeSound(
      'padded.wav',
      'sine=frequency=440:duration=1:sample_rate=44100',
      'adelay=1000:all=1,apad=pad_dur=1.5',
    );
    expect(await lengthOf(input)).toBeCloseTo(3.5, 1);
    const out = String(
      await ffmpegAudioEngine.convert({
        input,
        inputExt: 'wav',
        outputExt: 'flac',
        options: { trimSilence: true },
        workDir,
      }),
    );
    // The tone plus a little rest on both sides.
    const length = await lengthOf(out);
    expect(length).toBeGreaterThan(1);
    expect(length).toBeLessThan(1.4);
  });

  it('says so when a file is nothing but silence', async () => {
    const input = await makeSound('silent.wav', 'anullsrc=r=44100:cl=mono:d=2');
    await expect(
      ffmpegAudioEngine.convert({
        input,
        inputExt: 'wav',
        outputExt: 'mp3',
        options: { trimSilence: true },
        workDir,
      }),
    ).rejects.toMatchObject({ messageKey: 'errors.allSilent' });
  });

  it('evens out the loudness to the chosen target', async () => {
    // A quiet tone (around −35 LUFS).
    const input = await makeSound(
      'quiet.wav',
      'sine=frequency=440:duration=6:sample_rate=44100',
      'volume=0.02',
    );
    const out = String(
      await ffmpegAudioEngine.convert({
        input,
        inputExt: 'wav',
        outputExt: 'flac',
        options: { loudness: 'speech' },
        workDir,
      }),
    );
    const { stderr } = await runProcess('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-i',
      out,
      '-af',
      'ebur128',
      '-f',
      'null',
      '-',
    ]);
    const integrated = Number(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/.exec(stderr)?.[1]);
    expect(integrated).toBeGreaterThan(-18);
    expect(integrated).toBeLessThan(-14);
    const { stdout } = await runProcess('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=sample_rate',
      '-of',
      'default=nw=1:nk=1',
      out,
    ]);
    expect(stdout.trim()).toBe('48000');
  });

  it('makes animated WebP pictures from videos', async () => {
    const out = String(
      await ffmpegVideoEngine.convert({
        input: path.join(fixtures, 'sample.mp4'),
        inputExt: 'mp4',
        outputExt: 'webp',
        options: { fps: '10' },
        workDir,
      }),
    );
    expect((await fileTypeFromFile(out))?.ext).toBe('webp');
  }, 60_000);

  it('reports a missing sound track clearly', async () => {
    const silent = await ffmpegVideoEngine.convert({
      input: path.join(fixtures, 'sample.mp4'),
      inputExt: 'mp4',
      outputExt: 'mp4',
      options: { removeAudio: true },
      workDir,
    });
    await expect(
      ffmpegVideoEngine.convert({
        input: String(silent),
        inputExt: 'mp4',
        outputExt: 'mp3',
        options: {},
        workDir,
      }),
    ).rejects.toMatchObject({
      messageKey: expect.stringMatching(/noMatchingStream|convertFailed/),
    });
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    const running = ffmpegVideoEngine.convert({
      input: path.join(fixtures, 'sample.mp4'),
      inputExt: 'mp4',
      outputExt: 'webm',
      options: { encoderSpeed: 'small' },
      workDir,
      signal: controller.signal,
    });
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('detects hardware (no GPU in CI is fine)', () => {
    const info = getHardwareInfo();
    expect(info.compiled).toEqual(expect.arrayContaining(['nvenc', 'vaapi']));
    expect(info.gpu === null || ['nvenc', 'qsv', 'vaapi'].includes(info.gpu)).toBe(true);
  });
});
