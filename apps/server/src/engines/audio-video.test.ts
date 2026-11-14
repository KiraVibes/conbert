import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildVisualizerArgs } from '@conbert/core';
import { runProcess } from '../lib/run-process';
import { hasCommand } from '../test/helpers';
import { audioVideoEngine } from './audio-video';

const fixtures = path.join(import.meta.dirname, '../__fixtures__');

describe('audio → video arguments', () => {
  it('forces the demuxers, allows only local files and never builds a shell string', () => {
    const args = buildVisualizerArgs({
      input: '/in/song',
      inputExt: 'mp3',
      output: '/out/video',
      outputExt: 'mp4',
      options: { vizStyle: 'bars', vizColor: 'cyan' },
      cover: '/in/cover.png',
      duration: 12.5,
    });
    const first = args.indexOf('-i');
    expect(args.slice(first - 4, first + 2)).toEqual([
      '-protocol_whitelist',
      'file',
      '-f',
      'mp3',
      '-i',
      '/in/song',
    ]);
    const second = args.indexOf('-i', first + 1);
    expect(args[second + 1]).toBe('/in/cover.png');
    expect(args).toContain('image2');
    expect(args.join(' ')).toContain('showfreqs');
    expect(args.join(' ')).toContain('0x22d3ee');
    expect(args.slice(-5)).toEqual(['-t', '12.500', '-f', 'mp4', '/out/video']);
  });

  it('falls back to safe values for unknown options', () => {
    const args = buildVisualizerArgs({
      input: '/a',
      inputExt: 'wav',
      output: '/b',
      outputExt: 'webm',
      options: { vizStyle: 'evil;rm', vizColor: '$(x)', vizSize: 'huge' },
    });
    const graph = args[args.indexOf('-filter_complex') + 1] ?? '';
    expect(graph).toContain('showwaves=s=1280x');
    expect(graph).toContain('0xa78bfa');
    expect(args).toContain('libvpx-vp9');
  });

  it('refuses unknown containers', () => {
    expect(() =>
      buildVisualizerArgs({
        input: '/a',
        inputExt: 'xyz',
        output: '/b',
        outputExt: 'mp4',
        options: {},
      }),
    ).toThrow();
  });
});

const installed = hasCommand('ffmpeg') && hasCommand('ffprobe');

describe.skipIf(!installed)('audio → video (real ffmpeg)', () => {
  let workDir: string;
  beforeAll(async () => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-viz-'));
    await audioVideoEngine.init();
  });
  afterAll(() => rmSync(workDir, { recursive: true, force: true }));

  const probe = async (file: string) => {
    const { stdout } = await runProcess('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,width,height',
      '-of',
      'csv=p=0',
      file,
    ]);
    return stdout.trim().split('\n').sort();
  };

  for (const style of ['wave', 'bars', 'spectrum', 'still']) {
    it(`mp3 → mp4 (${style}, with cover)`, async () => {
      // Uploads have no ending – the engine must find the cover's type itself.
      const cover = path.join(workDir, `cover-${style}`);
      copyFileSync(path.join(fixtures, 'sample.png'), cover);
      const out = String(
        await audioVideoEngine.convert({
          input: path.join(fixtures, 'sample.mp3'),
          inputExt: 'mp3',
          outputExt: 'mp4',
          options: { vizStyle: style, vizSize: 'square' },
          attachments: { vizCover: cover },
          workDir,
        }),
      );
      expect(await probe(out)).toEqual(['audio', 'video,1080,1080']);
    }, 120_000);
  }

  it('flac → webm without cover', async () => {
    const out = String(
      await audioVideoEngine.convert({
        input: path.join(fixtures, 'sample.flac'),
        inputExt: 'flac',
        outputExt: 'webm',
        options: {},
        workDir,
      }),
    );
    expect(await probe(out)).toEqual(['audio', 'video,1280,720']);
  }, 120_000);

  it('refuses a cover that is no picture', async () => {
    const cover = path.join(workDir, 'not-a-picture');
    copyFileSync(path.join(fixtures, 'sample.csv'), cover);
    await expect(
      audioVideoEngine.convert({
        input: path.join(fixtures, 'sample.mp3'),
        inputExt: 'mp3',
        outputExt: 'mp4',
        options: {},
        attachments: { vizCover: cover },
        workDir,
      }),
    ).rejects.toMatchObject({ messageKey: 'errors.coverInvalid' });
  });
});
