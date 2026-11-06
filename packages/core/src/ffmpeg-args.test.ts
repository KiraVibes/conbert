import { describe, expect, it } from 'vitest';
import {
  buildFfmpegArgs,
  filterPath,
  parseAudioChannels,
  parseTrailingSilence,
  probeArgs,
  silenceDetectArgs,
} from './ffmpeg-args';
import { resolveBurnSubtitles } from './options/subtitles';

const base = { input: 'input.mp4', output: 'output', options: {} };

describe('ffmpeg arguments for ffmpeg.wasm', () => {
  it('uses one thread and no progress pipe', () => {
    const args = buildFfmpegArgs({ ...base, inputExt: 'mp4', outputExt: 'mp4', target: 'wasm' });
    expect(args).toEqual(
      expect.arrayContaining([
        '-threads',
        '1',
        '-filter_threads',
        '1',
        '-filter_complex_threads',
        '1',
      ]),
    );
    expect(args).not.toContain('-progress');
  });

  it('encodes WebM as VP8 (VP9 hangs in ffmpeg.wasm)', () => {
    const args = buildFfmpegArgs({ ...base, inputExt: 'mp4', outputExt: 'webm', target: 'wasm' });
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libvpx', '-b:v', '2M']));
  });

  it('falls back from AV1 and never uses a GPU', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'mov',
      outputExt: 'mp4',
      target: 'wasm',
      gpu: 'nvenc',
      options: { videoCodec: 'av1' },
    });
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264']));
  });

  it('keeps the native behaviour unchanged', () => {
    const args = buildFfmpegArgs({ ...base, inputExt: 'mp4', outputExt: 'webm' });
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libvpx-vp9', '-progress', 'pipe:1']));
    expect(args).not.toContain('-filter_complex_threads');
  });
});

describe('burning subtitles into the picture', () => {
  const job = { input: '/data/tmp/j1/0b7c.mkv', output: '/data/tmp/j1/out.mp4', inputExt: 'mkv' };
  const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

  it('reads the option', () => {
    expect(resolveBurnSubtitles({})).toBeNull();
    expect(resolveBurnSubtitles({ burnSubtitles: true })).toEqual({ track: 0 });
    expect(resolveBurnSubtitles({ burnSubtitles: true, burnSubtitleTrack: 3 })).toEqual({
      track: 2,
    });
  });

  it('draws text subtitles before the pixel format changes', () => {
    const args = buildFfmpegArgs({
      ...job,
      outputExt: 'mp4',
      options: { resolution: '720' },
      burnSubtitles: { track: 1, picture: false },
    });
    expect(after(args, '-vf')).toBe(
      "scale=-2:'min(ih,720)',subtitles=filename='/data/tmp/j1/0b7c.mkv':si=1,format=yuv420p",
    );
  });

  it('keeps the times right for a cut part', () => {
    const args = buildFfmpegArgs({
      ...job,
      outputExt: 'mp4',
      options: { trimStart: 12.5, trimEnd: 20, trimFast: true },
      burnSubtitles: { track: 0, picture: false },
    });
    expect(after(args, '-vf')).toContain(
      "setpts=PTS+12.5/TB,subtitles=filename='/data/tmp/j1/0b7c.mkv':si=0,setpts=PTS-STARTPTS",
    );
    // Burning in needs new pictures: no quick copy.
    expect(args).not.toContain('copy');
  });

  it('lays picture subtitles (DVD, Blu-ray) over the video', () => {
    const args = buildFfmpegArgs({
      ...job,
      outputExt: 'mkv',
      options: {},
      burnSubtitles: { track: 0, picture: true },
    });
    expect(after(args, '-filter_complex')).toMatch(/^\[0:v:0\]\[0:s:0\]overlay.*\[v\]$/);
    expect(after(args, '-map')).toBe('[v]');
    expect(args).not.toContain('-vf');
  });

  it('draws a chosen subtitle file', () => {
    const args = buildFfmpegArgs({
      ...job,
      outputExt: 'mp4',
      options: {},
      burnSubtitles: { file: '/data/tmp/j1/9f2e.ass' },
    });
    expect(after(args, '-vf')).toBe("subtitles=filename='/data/tmp/j1/9f2e.ass',format=yuv420p");
  });

  it('only puts plain job paths into a filter', () => {
    expect(filterPath('E:\\Conbert\\data\\a.mkv')).toBe("'E\\:/Conbert/data/a.mkv'");
    expect(() => filterPath("/tmp/it's,[x].mkv")).toThrow();
  });
});

describe('sound clean-up', () => {
  const af = (args: string[]) => args[args.indexOf('-af') + 1];

  it('evens out the loudness with loudnorm and a normal sample rate', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'wav',
      outputExt: 'mp3',
      options: { loudness: 'speech' },
    });
    expect(af(args)).toBe('loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000');
    const chosen = buildFfmpegArgs({
      ...base,
      inputExt: 'wav',
      outputExt: 'flac',
      options: { loudness: 'broadcast', sampleRate: '44100' },
    });
    expect(af(chosen)).toBe('loudnorm=I=-23:TP=-1:LRA=11,aresample=44100');
  });

  it('also evens out the sound of videos, but never cuts it there', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'mov',
      outputExt: 'mp4',
      options: { loudness: 'music', trimSilence: true },
    });
    expect(af(args)).toBe('loudnorm=I=-14:TP=-1:LRA=11,aresample=48000');
    expect(args.indexOf('-af')).toBeLessThan(args.indexOf('-c:a'));
  });

  it('ignores unknown loudness values', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'wav',
      outputExt: 'mp3',
      options: { loudness: 'loud;rm -rf' },
    });
    expect(args).not.toContain('-af');
  });

  it('cuts silence at the start and at the end the first pass found', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'wav',
      outputExt: 'ogg',
      options: { trimSilence: true, loudness: 'music' },
      trailingSilenceAt: 12.5,
    });
    expect(af(args)).toBe(
      'atrim=end=12.6,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.1,' +
        'loudnorm=I=-14:TP=-1:LRA=11,aresample=48000',
    );
  });

  it('counts the end from the start of a cut part and turns off fast cutting', () => {
    const args = buildFfmpegArgs({
      ...base,
      inputExt: 'mp3',
      outputExt: 'mp3',
      options: { trimSilence: true, trimStart: 2, trimFast: true },
      trailingSilenceAt: 10,
    });
    expect(af(args)).toMatch(/^atrim=end=8\.1,silenceremove/);
    expect(args).not.toContain('copy');
  });

  it('tells ffmpeg.wasm the channel count after loudnorm', () => {
    const wasm = (options: Record<string, unknown>, audioChannels: number | null) =>
      buildFfmpegArgs({
        ...base,
        inputExt: 'wav',
        outputExt: 'flac',
        options,
        target: 'wasm',
        audioChannels,
      });
    const ac = (args: string[]) => args.filter((_, i) => args[i - 1] === '-ac');
    expect(ac(wasm({ loudness: 'music' }, 6))).toEqual(['6']);
    expect(ac(wasm({ loudness: 'music' }, null))).toEqual(['2']);
    expect(ac(wasm({ loudness: 'music', channels: 'mono' }, 6))).toEqual(['1']);
    expect(ac(wasm({}, 6))).toEqual([]);
    // Native ffmpeg keeps the layout itself.
    const native = buildFfmpegArgs({
      ...base,
      inputExt: 'wav',
      outputExt: 'flac',
      options: { loudness: 'music' },
      audioChannels: 6,
    });
    expect(native).not.toContain('-ac');
  });

  it('lets the first look log its findings, even after a quiet run in ffmpeg.wasm', () => {
    for (const args of [silenceDetectArgs('in.wav', 'wav'), probeArgs('in.wav', 'wav')]) {
      expect(args.slice(args.indexOf('-loglevel'), args.indexOf('-loglevel') + 2)).toEqual([
        '-loglevel',
        'info',
      ]);
      expect(args.slice(args.indexOf('-f'), args.indexOf('-f') + 4)).toEqual([
        '-f',
        'wav',
        '-i',
        'in.wav',
      ]);
    }
  });

  it('reads the channel count from the log', () => {
    const line = (layout: string) =>
      `  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, ${layout}, s16, 705 kb/s\n`;
    expect(parseAudioChannels(line('mono'))).toBe(1);
    expect(parseAudioChannels(line('stereo'))).toBe(2);
    expect(parseAudioChannels(line('5.1(side)'))).toBe(6);
    expect(parseAudioChannels(line('7.1'))).toBe(8);
    expect(parseAudioChannels(line('3 channels'))).toBe(3);
    expect(parseAudioChannels('Stream #0:0: Video: h264, 1920x1080')).toBeNull();
  });

  it('finds the silence at the end in old and new ffmpeg logs', () => {
    const head = 'Duration: 00:00:10.00, start: 0.000000, bitrate: 1411 kb/s\n';
    // Older ffmpeg (ffmpeg.wasm): the last silence stays open.
    expect(
      parseTrailingSilence(
        `${head}[silencedetect] silence_start: 0\n[silencedetect] silence_end: 1.2 | silence_duration: 1.2\n[silencedetect] silence_start: 8.4\n`,
        null,
      ),
    ).toEqual({ trailingAt: 8.4, allSilent: false });
    // Newer ffmpeg closes it at the end of the file.
    expect(
      parseTrailingSilence('silence_start: 8.4\nsilence_end: 10 | silence_duration: 1.6\n', 10),
    ).toEqual({ trailingAt: 8.4, allSilent: false });
    // A pause in the middle is no silence at the end.
    expect(
      parseTrailingSilence(`${head}silence_start: 4\nsilence_end: 5 | silence_duration: 1\n`, null),
    ).toEqual({ trailingAt: null, allSilent: false });
    expect(parseTrailingSilence(head, null)).toEqual({ trailingAt: null, allSilent: false });
    expect(parseTrailingSilence(`${head}silence_start: 0\n`, null)).toEqual({
      trailingAt: null,
      allSilent: true,
    });
  });
});
