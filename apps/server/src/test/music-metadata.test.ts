import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ffmpegMetadataArgs } from '@conbert/core';
import { runProcess } from '../lib/run-process';
import { hasCommand } from './helpers';

/**
 * The browser rewrites music tags with ffmpeg.wasm; the arguments come from
 * @conbert/core. Here the same arguments run through native ffmpeg.
 */
const installed = hasCommand('ffmpeg') && hasCommand('ffprobe');
const fixtures = path.join(import.meta.dirname, '../__fixtures__');

describe.skipIf(!installed)('music tags via ffmpeg (real)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'conbert-tags-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const tagsOf = async (file: string) => {
    const { stdout } = await runProcess('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format_tags:stream_tags',
      '-of',
      'json',
      file,
    ]);
    const json = JSON.parse(stdout) as {
      format?: { tags?: Record<string, string> };
      streams?: { tags?: Record<string, string> }[];
    };
    const all: Record<string, string> = { ...json.format?.tags };
    for (const s of json.streams ?? []) Object.assign(all, s.tags);
    return Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), v]));
  };

  for (const ext of ['mp3', 'flac', 'ogg', 'opus', 'wav']) {
    it(`writes and removes tags in ${ext}`, async () => {
      const written = path.join(dir, `written.${ext}`);
      await runProcess(
        'ffmpeg',
        ffmpegMetadataArgs(path.join(fixtures, `sample.${ext}`), written, ext, {
          values: { title: 'Zauberlied', author: 'Conbert', copyright: '2026 Conbert' },
          removeGps: false,
          removeAll: false,
        }),
      );
      expect(await tagsOf(written)).toMatchObject({ title: 'Zauberlied', artist: 'Conbert' });

      const cleaned = path.join(dir, `cleaned.${ext}`);
      await runProcess(
        'ffmpeg',
        ffmpegMetadataArgs(written, cleaned, ext, {
          values: {},
          removeGps: false,
          removeAll: true,
        }),
      );
      const left = await tagsOf(cleaned);
      expect(left['title']).toBeUndefined();
      expect(left['artist']).toBeUndefined();
    });
  }
});
