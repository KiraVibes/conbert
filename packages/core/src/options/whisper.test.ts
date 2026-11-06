import { describe, expect, it } from 'vitest';
import { isSensibleTarget } from '../target-rules';
import { parseWhisperProgress, resolveWhisper, whisperArgs, whisperModel } from './whisper';

describe('Whisper settings', () => {
  it('only lets known languages through', () => {
    expect(resolveWhisper({})).toEqual({ language: 'auto', translate: false });
    expect(resolveWhisper({ speechLanguage: 'de', translateToEnglish: true })).toEqual({
      language: 'de',
      translate: true,
    });
    expect(resolveWhisper({ speechLanguage: '--model /etc/passwd' }).language).toBe('auto');
  });

  it('builds the whisper-cli command line', () => {
    expect(
      whisperArgs({
        model: '/m/small.bin',
        input: 'in.wav',
        outputBase: '/w/out',
        outputExt: 'vtt',
        settings: { language: 'de', translate: true },
        threads: 4,
      }),
    ).toEqual([
      '--model',
      '/m/small.bin',
      '--file',
      'in.wav',
      '--language',
      'de',
      '--translate',
      '--threads',
      '4',
      '--output-vtt',
      '--output-file',
      '/w/out',
      '--print-progress',
      '--no-prints',
    ]);
  });

  it('reads the progress', () => {
    expect(parseWhisperProgress('whisper_print_progress_callback: progress =  45%\n')).toBe(45);
    expect(parseWhisperProgress('progress = 5%\nprogress = 10%')).toBe(10);
    expect(parseWhisperProgress('nothing')).toBeNull();
  });

  it('knows the models', () => {
    expect(whisperModel('small')?.file).toBe('ggml-small-q5_1.bin');
    expect(whisperModel('huge')).toBeUndefined();
  });

  it('allows speech to text only from sound and videos', () => {
    expect(isSensibleTarget('mp3', 'srt')).toBe(true);
    expect(isSensibleTarget('mp4', 'vtt')).toBe(true);
    expect(isSensibleTarget('wav', 'txt')).toBe(true);
    expect(isSensibleTarget('png', 'srt')).toBe(false);
    expect(isSensibleTarget('mp3', 'docx')).toBe(false);
  });
});
