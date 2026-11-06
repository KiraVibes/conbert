import { readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProcess } from '../lib/run-process';
import { hasCommand } from '../test/helpers';
import { ModelStore } from '../models/model-store';
import { configureWhisper } from '../whisper/setup';
import { whisperEngine } from './whisper';

/** Set in the test image: the smallest model, ready on disk. */
const modelFile = process.env['CONBERT_TEST_WHISPER_MODEL'];
const installed =
  modelFile !== undefined &&
  hasCommand('whisper-cli', ['--help']) &&
  hasCommand('espeak-ng', ['--version']) &&
  hasCommand('ffmpeg');

describe.skipIf(!installed)('Whisper (real whisper.cpp)', () => {
  let dir: string;
  let speech: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'conbert-whisper-'));
    const file = modelFile ?? '';
    const tiny = {
      id: 'tiny',
      file: path.basename(file),
      bytes: statSync(file).size,
      sha256: 'not checked – already on disk',
    };
    configureWhisper(
      new ModelStore(path.dirname(file), 'http://127.0.0.1:9/', [tiny]),
      () => 'tiny',
    );
    await whisperEngine.init();
    // A short English sentence, spoken by a speech synthesizer, as MP3.
    const wav = path.join(dir, 'speech.wav');
    await runProcess('espeak-ng', [
      '-v',
      'en',
      '-s',
      '140',
      '-w',
      wav,
      'Hello world. Good morning.',
    ]);
    speech = path.join(dir, 'speech.mp3');
    await runProcess('ffmpeg', ['-loglevel', 'error', '-i', wav, speech]);
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes subtitles with timestamps', async () => {
    expect(whisperEngine.status()).toBe('ready');
    const progress: number[] = [];
    const out = await whisperEngine.convert({
      input: speech,
      inputExt: 'mp3',
      outputExt: 'srt',
      options: { speechLanguage: 'en' },
      workDir: path.join(dir, 'job1'),
      onProgress: (p) => progress.push(p.percent),
    });
    const srt = readFileSync(String(out), 'utf8');
    expect(srt).toMatch(/00:00:0\d,\d{3} --> /);
    expect(srt.toLowerCase()).toMatch(/hello|world|morning/);
    expect(progress.at(-1)).toBe(100);
  }, 120_000);

  it('writes plain text and web subtitles', async () => {
    const txt = await whisperEngine.convert({
      input: speech,
      inputExt: 'mp3',
      outputExt: 'txt',
      options: {},
      workDir: path.join(dir, 'job2'),
    });
    expect(readFileSync(String(txt), 'utf8').toLowerCase()).toMatch(/hello|world|morning/);
    const vtt = await whisperEngine.convert({
      input: speech,
      inputExt: 'mp3',
      outputExt: 'vtt',
      options: {},
      workDir: path.join(dir, 'job3'),
    });
    expect(readFileSync(String(vtt), 'utf8')).toMatch(/^WEBVTT/);
  }, 120_000);

  it('explains recordings without speech', async () => {
    const silence = path.join(dir, 'silence.wav');
    await runProcess('ffmpeg', [
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=16000:cl=mono',
      '-t',
      '2',
      silence,
    ]);
    await expect(
      whisperEngine.convert({
        input: silence,
        inputExt: 'wav',
        outputExt: 'srt',
        options: { speechLanguage: 'en' },
        workDir: path.join(dir, 'job4'),
      }),
    ).rejects.toMatchObject({ messageKey: 'errors.noSpeech' });
  }, 120_000);
});
