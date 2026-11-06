import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { describeEngine, findRoutes } from '@conbert/core';
import { hasCommand } from '../test/helpers';
import { runProcess } from '../lib/run-process';
import { FFMPEG, ffmpegVideoEngine } from './ffmpeg';
import { subtitleExtractEngine } from './subtitle-extract';
import { subtitlesServerEngine } from './subtitles';
import { whisperEngine } from './whisper';

const fixtures = path.join(import.meta.dirname, '../__fixtures__');
const work = mkdtempSync(path.join(os.tmpdir(), 'conbert-subtitles-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('subtitle files on the server', () => {
  it('converts SRT to WebVTT with the shared code', async () => {
    const input = path.join(work, 'in.srt');
    writeFileSync(input, '1\n00:00:01,000 --> 00:00:02,000\nHallo\n');
    const out = await subtitlesServerEngine.convert({
      input,
      inputExt: 'srt',
      outputExt: 'vtt',
      options: {},
      workDir: work,
    });
    expect(readFileSync(String(out), 'utf8')).toBe(
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHallo\n',
    );
  });
});

describe('which engine makes subtitles from a video', () => {
  const engines = [subtitleExtractEngine, whisperEngine].map(describeEngine);
  it('looks for built-in subtitles first', () => {
    expect(findRoutes(engines, 'mkv', 'srt', 'server')[0]?.steps[0]?.engineId).toBe(
      'subtitle-extract',
    );
  });
  it('lets Whisper do a part of the video (cutting)', () => {
    expect(findRoutes(engines, 'mkv', 'srt', 'server', { trim: true })[0]?.steps[0]?.engineId).toBe(
      'whisper',
    );
  });
});

describe.skipIf(!hasCommand('ffprobe'))('subtitles out of videos (ffmpeg)', () => {
  const extract = (file: string, outputExt: string, options: Record<string, unknown> = {}) =>
    subtitleExtractEngine.convert({
      input: path.join(fixtures, file),
      inputExt: 'mkv',
      outputExt,
      options,
      workDir: work,
    });

  it('takes the built-in track out as SRT', async () => {
    const out = await extract('sample-subtitles.mkv', 'srt');
    const text = readFileSync(String(out), 'utf8');
    expect(text).toContain('00:00:01,000 --> 00:00:02,500');
    expect(text).toContain('Oben, mit <i>Komma</i>');
  });

  it('keeps ASS as ASS and makes plain text', async () => {
    const ass = readFileSync(String(await extract('sample-subtitles.mkv', 'ass')), 'utf8');
    expect(ass).toContain('[Events]');
    expect(ass).toContain('Erste\\NZweite');
    const txt = readFileSync(String(await extract('sample-subtitles.mkv', 'txt')), 'utf8');
    expect(txt).toBe('Oben, mit Komma\nErste Zweite\n');
  });

  it('explains a video without subtitles', async () => {
    await expect(extract('sample.mkv', 'srt', { subtitleSource: 'track' })).rejects.toMatchObject({
      messageKey: 'errors.subtitlesNoTrack',
    });
    await expect(
      extract('sample-subtitles.mkv', 'srt', { subtitleSource: 'track', subtitleTrack: 3 }),
    ).rejects.toMatchObject({ messageKey: 'errors.subtitlesNoTrack' });
  });
});

describe.skipIf(!hasCommand('ffprobe'))('burning subtitles into the picture', () => {
  const video = path.join(fixtures, 'sample-subtitles.mkv');
  const toMp4 = (options: Record<string, unknown>) =>
    ffmpegVideoEngine.convert({
      input: video,
      inputExt: 'mkv',
      outputExt: 'mp4',
      options,
      workDir: work,
    });
  /** One frame as raw grey pixels. */
  const frame = async (file: string) => {
    const out = path.join(work, `${path.basename(file)}.gray`);
    await runProcess(FFMPEG, [
      '-v',
      'error',
      '-y',
      '-ss',
      '1.5',
      '-i',
      file,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      out,
    ]);
    return readFileSync(out);
  };

  it('writes the text into the picture (text track and picture-free video)', async () => {
    const plain = await frame(String(await toMp4({})));
    const burnt = await frame(String(await toMp4({ burnSubtitles: true, burnSubtitleTrack: 2 })));
    expect(burnt.length).toBe(plain.length);
    // White letters on grey: many pixels got brighter.
    let brighter = 0;
    for (let i = 0; i < plain.length; i++) if ((burnt[i] ?? 0) > (plain[i] ?? 0) + 60) brighter++;
    expect(brighter).toBeGreaterThan(50);
  }, 60_000);

  it('burns in a chosen subtitle file (old Windows-1252 SRT)', async () => {
    const srt = path.join(work, 'eigene');
    writeFileSync(
      srt,
      Buffer.from('1\r\n00:00:00,200 --> 00:00:02,800\r\nGRÜSSE AUS KÖLN\r\n', 'latin1'),
    );
    const plain = await frame(String(await toMp4({})));
    const out = await ffmpegVideoEngine.convert({
      input: video,
      inputExt: 'mkv',
      outputExt: 'mp4',
      options: {},
      attachments: { burnSubtitleFile: srt },
      workDir: work,
    });
    const burnt = await frame(String(out));
    let brighter = 0;
    for (let i = 0; i < plain.length; i++) if ((burnt[i] ?? 0) > (plain[i] ?? 0) + 60) brighter++;
    expect(brighter).toBeGreaterThan(50);
  }, 60_000);

  it('explains a missing track', async () => {
    await expect(toMp4({ burnSubtitles: true, burnSubtitleTrack: 5 })).rejects.toMatchObject({
      messageKey: 'errors.subtitlesNoTrack',
    });
  });
});
