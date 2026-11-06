import { bitratesForTarget } from './compression';
import {
  LOUDNESS_TARGETS,
  resolveMediaOptions,
  type MediaOptions,
  type QualityLevel,
} from './options/media';

/** ffmpeg demuxer per input format. Forcing it stops ffmpeg from treating a
 * disguised playlist (HLS/concat) as such – those could read other files. */
export const DEMUXER: Record<string, string> = {
  mp4: 'mov',
  mov: 'mov',
  m4a: 'mov',
  mkv: 'matroska',
  webm: 'matroska',
  avi: 'avi',
  wmv: 'asf',
  wma: 'asf',
  mpg: 'mpeg',
  gif: 'gif',
  mp3: 'mp3',
  wav: 'wav',
  flac: 'flac',
  ogg: 'ogg',
  opus: 'ogg',
  aac: 'aac',
  aiff: 'aiff',
};

/** ffmpeg muxer per output format. */
export const MUXER: Record<string, string> = {
  mp4: 'mp4',
  mov: 'mov',
  mkv: 'matroska',
  webm: 'webm',
  avi: 'avi',
  wmv: 'asf',
  mpg: 'mpeg',
  gif: 'gif',
  webp: 'webp',
  mp3: 'mp3',
  wav: 'wav',
  flac: 'flac',
  ogg: 'ogg',
  opus: 'opus',
  m4a: 'ipod',
  aac: 'adts',
  aiff: 'aiff',
};

export type GpuKind = 'nvenc' | 'qsv' | 'vaapi';
export const VAAPI_DEVICE = '/dev/dri/renderD128';

type SoftwareCodec =
  'libx264' | 'libx265' | 'libsvtav1' | 'libvpx-vp9' | 'libvpx' | 'mpeg4' | 'wmv2' | 'mpeg2video';

const CRF: Record<string, Record<QualityLevel, number>> = {
  libx264: { high: 18, balanced: 23, small: 28 },
  libx265: { high: 20, balanced: 26, small: 31 },
  libsvtav1: { high: 24, balanced: 32, small: 40 },
  'libvpx-vp9': { high: 24, balanced: 32, small: 40 },
  libvpx: { high: 10, balanced: 20, small: 35 },
};
/** Fixed quantizer for the old codecs (lower = better). */
const OLD_Q: Record<QualityLevel, number> = { high: 2, balanced: 4, small: 8 };
const X26X_PRESET = { fast: 'veryfast', balanced: 'medium', small: 'slow' } as const;
const SVT_PRESET = { fast: 10, balanced: 8, small: 5 } as const;
const VP9_CPU = { fast: 6, balanced: 4, small: 2 } as const;
const NVENC_PRESET = { fast: 'p2', balanced: 'p4', small: 'p6' } as const;
const QSV_PRESET = { fast: 'veryfast', balanced: 'medium', small: 'slower' } as const;

const MP3_VBR: Record<QualityLevel, number> = { high: 0, balanced: 2, small: 6 };
const VORBIS_Q: Record<QualityLevel, number> = { high: 7, balanced: 5, small: 2 };
const OPUS_KBPS: Record<QualityLevel, number> = { high: 160, balanced: 96, small: 48 };
const AAC_KBPS: Record<QualityLevel, number> = { high: 256, balanced: 160, small: 96 };

export const VIDEO_OUTPUTS = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'mpg']);
export const AUDIO_OUTPUTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'aiff']);

/** Where ffmpeg runs: natively on the server or as ffmpeg.wasm in the browser. */
export type FfmpegTarget = 'native' | 'wasm';

/** Which video codec a target gets (respecting what the container allows). */
export function pickVideoCodec(
  outputExt: string,
  o: MediaOptions,
  target: FfmpegTarget = 'native',
): SoftwareCodec {
  // ffmpeg.wasm has no AV1 encoder – fall back to the container's default.
  const av1 = o.videoCodec === 'av1' && target === 'native';
  switch (outputExt) {
    case 'webm':
      // VP9 hangs in ffmpeg.wasm 0.12 – the browser uses VP8 for WebM.
      if (target === 'wasm') return 'libvpx';
      return av1 ? 'libsvtav1' : 'libvpx-vp9';
    case 'mp4':
    case 'mov':
    case 'mkv':
      if (o.videoCodec === 'h265') return 'libx265';
      if (av1) return 'libsvtav1';
      if (o.videoCodec === 'vp9' && outputExt === 'mkv') {
        return target === 'wasm' ? 'libvpx' : 'libvpx-vp9';
      }
      return 'libx264';
    case 'avi':
      return 'mpeg4';
    case 'wmv':
      return 'wmv2';
    case 'mpg':
      return 'mpeg2video';
    default:
      return 'libx264';
  }
}

/** GPU encoder name for a software codec, if one exists for that kind of GPU. */
export function gpuEncoder(codec: SoftwareCodec, gpu: GpuKind): string | null {
  const family =
    codec === 'libx264'
      ? 'h264'
      : codec === 'libx265'
        ? 'hevc'
        : codec === 'libsvtav1'
          ? 'av1'
          : null;
  return family ? `${family}_${gpu}` : null;
}

function scaleFilter(maxHeight: number | null): string | null {
  // Keep the aspect ratio, even width, never upscale.
  return maxHeight ? `scale=-2:'min(ih,${maxHeight})'` : null;
}

function videoArgs(
  outputExt: string,
  o: MediaOptions,
  gpu: GpuKind | null,
  target: FfmpegTarget,
  bitrateKbps: number | null,
): { args: string[]; filters: string[] } {
  const codec = pickVideoCodec(outputExt, o, target);
  // Target size: an average bitrate (with some headroom) instead of constant quality.
  const rate = bitrateKbps
    ? [
        '-b:v',
        `${bitrateKbps}k`,
        '-maxrate',
        `${Math.round(bitrateKbps * 1.5)}k`,
        '-bufsize',
        `${bitrateKbps * 2}k`,
      ]
    : null;
  const filters: string[] = [];
  const scale = scaleFilter(o.resolution);
  if (scale) filters.push(scale);
  if (o.fps) filters.push(`fps=${o.fps}`);

  const hw = gpu && o.useGpu ? gpuEncoder(codec, gpu) : null;
  const crf = CRF[codec]?.[o.videoQuality] ?? 23;
  if (hw && gpu === 'nvenc') {
    filters.push('format=yuv420p');
    return {
      args: [
        '-c:v',
        hw,
        '-preset',
        NVENC_PRESET[o.encoderSpeed],
        '-rc',
        'vbr',
        ...(rate ?? ['-cq', String(crf), '-b:v', '0']),
      ],
      filters,
    };
  }
  if (hw && gpu === 'qsv') {
    filters.push('format=nv12');
    return {
      args: [
        '-c:v',
        hw,
        '-preset',
        QSV_PRESET[o.encoderSpeed],
        ...(rate ?? ['-global_quality', String(crf)]),
      ],
      filters,
    };
  }
  if (hw && gpu === 'vaapi') {
    filters.push('format=nv12', 'hwupload');
    return { args: ['-c:v', hw, ...(rate ?? ['-qp', String(crf)])], filters };
  }

  switch (codec) {
    case 'libx264':
    case 'libx265':
      filters.push('format=yuv420p');
      return {
        args: [
          '-c:v',
          codec,
          ...(rate ?? ['-crf', String(crf)]),
          '-preset',
          X26X_PRESET[o.encoderSpeed],
          // Apple devices only play H.265 in MP4/MOV with this tag.
          ...(codec === 'libx265' && (outputExt === 'mp4' || outputExt === 'mov')
            ? ['-tag:v', 'hvc1']
            : []),
        ],
        filters,
      };
    case 'libsvtav1':
      filters.push('format=yuv420p');
      return {
        args: [
          '-c:v',
          codec,
          ...(rate ?? ['-crf', String(crf)]),
          '-preset',
          String(SVT_PRESET[o.encoderSpeed]),
        ],
        filters,
      };
    case 'libvpx-vp9':
      filters.push('format=yuv420p');
      return {
        args: [
          '-c:v',
          codec,
          ...(rate ?? ['-crf', String(crf), '-b:v', '0']),
          '-deadline',
          'good',
          '-cpu-used',
          String(VP9_CPU[o.encoderSpeed]),
          '-row-mt',
          '1',
        ],
        filters,
      };
    case 'libvpx':
      // VP8: constant quality with an upper bitrate limit.
      filters.push('format=yuv420p');
      return { args: ['-c:v', codec, ...(rate ?? ['-crf', String(crf), '-b:v', '2M'])], filters };
    case 'wmv2':
      return {
        args: ['-c:v', codec, ...(rate ?? ['-q:v', String(OLD_Q[o.videoQuality])])],
        filters,
      };
    default:
      filters.push('format=yuv420p');
      return {
        args: ['-c:v', codec, ...(rate ?? ['-q:v', String(OLD_Q[o.videoQuality])])],
        filters,
      };
  }
}

/** Quieter than this counts as silence (a quiet room, tape hiss). */
const SILENCE_DB = -50;
/** A little of the silence stays, so the sound doesn't start or stop abruptly. */
const SILENCE_KEEP = 0.1;
/** loudnorm works at 192 kHz inside; without a chosen rate the result gets this one. */
const LOUDNESS_RATE = 48000;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** What a first look at the input found out (see SoundInfo in FfmpegArgsInput). */
interface Sound {
  silenceAt: number | null;
  channels: number | null;
  target: FfmpegTarget;
}

/**
 * Sound filters: cut silence at the start (silenceremove) and – at the time a
 * first pass found (see parseTrailingSilence) – at the end, then even out the
 * loudness (loudnorm, one pass, EBU R128 measure). Returns -af and, where
 * needed, the channel count.
 */
function audioCleanupArgs(o: MediaOptions, outputExt: string, sound: Sound): string[] {
  const { silenceAt } = sound;
  const filters: string[] = [];
  if (o.trimSilence && AUDIO_OUTPUTS.has(outputExt)) {
    // -ss before the input starts the timeline at 0.
    const end = silenceAt !== null ? silenceAt - (o.trimStart ?? 0) + SILENCE_KEEP : null;
    if (end !== null && end > 0) filters.push(`atrim=end=${round3(end)}`);
    filters.push(
      `silenceremove=start_periods=1:start_threshold=${SILENCE_DB}dB:start_silence=${SILENCE_KEEP}`,
    );
  }
  if (o.loudness) {
    const t = LOUDNESS_TARGETS[o.loudness];
    filters.push(
      `loudnorm=I=${t.lufs}:TP=${t.peak}:LRA=11`,
      `aresample=${o.sampleRate ?? LOUDNESS_RATE}`,
    );
  }
  if (filters.length === 0) return [];
  // loudnorm in ffmpeg 5 (ffmpeg.wasm) loses the channel layout, and the encoder
  // then can't pick one: give the count (stereo if the first look didn't find it).
  const count =
    o.loudness && sound.target === 'wasm' && o.channels === 'keep'
      ? ['-ac', String(sound.channels ?? 2)]
      : [];
  return ['-af', filters.join(','), ...count];
}

/** Whether "remove silence" needs the first pass (silenceDetectArgs) for this target. */
export function needsSilenceScan(outputExt: string, options: Record<string, unknown>): boolean {
  return AUDIO_OUTPUTS.has(outputExt) && resolveMediaOptions(options).trimSilence;
}

/** First pass for "remove silence": ffmpeg only listens and logs the silent parts. */
export function silenceDetectArgs(input: string, inputExt: string): string[] {
  const demuxer = DEMUXER[inputExt];
  if (!demuxer) throw new Error(`ffmpeg: .${inputExt} not supported`);
  return [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    // ffmpeg.wasm keeps the log level of the run before (error): the findings are "info".
    '-loglevel',
    'info',
    '-protocol_whitelist',
    'file',
    '-f',
    demuxer,
    '-i',
    input,
    '-map',
    '0:a:0',
    '-af',
    `silencedetect=noise=${SILENCE_DB}dB:d=0.3`,
    '-f',
    'null',
    '-',
  ];
}

/** A quick look at the input without converting (ffmpeg.wasm has no ffprobe). */
export function probeArgs(input: string, inputExt: string): string[] {
  const demuxer = DEMUXER[inputExt];
  if (!demuxer) throw new Error(`ffmpeg: .${inputExt} not supported`);
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'info',
    '-protocol_whitelist',
    'file',
    '-f',
    demuxer,
    '-i',
    input,
  ];
}

const LAYOUT_CHANNELS: Record<string, number> = {
  mono: 1,
  stereo: 2,
  downmix: 2,
  quad: 4,
  hexagonal: 6,
  octagonal: 8,
};

/**
 * Number of channels of the first sound track in ffmpeg's log
 * ("Audio: pcm_s16le, 44100 Hz, mono, s16" or "…, 5.1(side), …").
 */
export function parseAudioChannels(log: string): number | null {
  const layout = /Audio: [^\n]*?, \d+ Hz, ([^,\n]+)/.exec(log)?.[1]?.trim();
  if (!layout) return null;
  const name = layout.replace(/\(.*\)$/, '');
  const count = /^(\d+) channels?$/.exec(name);
  if (count) return Number(count[1]);
  const surround = /^(\d+)\.(\d+)$/.exec(name);
  if (surround) return Number(surround[1]) + Number(surround[2]);
  return LAYOUT_CHANNELS[name] ?? null;
}

export interface SilenceScan {
  /** Where the silence at the end begins (seconds), or null if the sound runs to the end. */
  trailingAt: number | null;
  /** Nothing but silence. */
  allSilent: boolean;
}

/**
 * Reads the log of silenceDetectArgs. Newer ffmpeg also closes a silence that
 * runs to the end of the file, older ones (ffmpeg.wasm) leave it open – both
 * count as silence at the end. `duration` comes from ffprobe or the log.
 */
export function parseTrailingSilence(log: string, duration: number | null): SilenceScan {
  const events = [...log.matchAll(/silence_(start|end): (-?[\d.]+)/g)].map((m) => ({
    kind: m[1],
    at: Number(m[2]),
  }));
  const fromLog = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
  const length =
    duration ??
    (fromLog ? Number(fromLog[1]) * 3600 + Number(fromLog[2]) * 60 + Number(fromLog[3]) : null);
  const last = events.at(-1);
  const lastStart = events.filter((e) => e.kind === 'start').at(-1);
  if (!last || !lastStart) return { trailingAt: null, allSilent: false };
  const toEnd =
    last.kind === 'start' || (length !== null && last.at >= length - 0.05) ? lastStart.at : null;
  const allSilent = toEnd !== null && toEnd <= 0.05;
  return { trailingAt: allSilent ? null : toEnd, allSilent };
}

function audioTrackArgs(outputExt: string, o: MediaOptions, sound: Sound): string[] {
  if (o.removeAudio) return ['-an'];
  const af = audioCleanupArgs(o, outputExt, sound);
  const kbps = (fallback: number) => `${o.audioBitrate ?? fallback}k`;
  switch (outputExt) {
    case 'webm':
      return [...af, '-c:a', 'libopus', '-b:a', kbps(96)];
    case 'avi':
      return [...af, '-c:a', 'libmp3lame', '-b:a', kbps(128)];
    case 'wmv':
      return [...af, '-c:a', 'wmav2', '-b:a', kbps(128)];
    case 'mpg':
      return [...af, '-c:a', 'mp2', '-b:a', kbps(192)];
    default:
      return [...af, '-c:a', 'aac', '-b:a', kbps(128)];
  }
}

function audioOnlyArgs(outputExt: string, o: MediaOptions, sound: Sound): string[] {
  const args = ['-vn', '-sn', '-dn', ...audioCleanupArgs(o, outputExt, sound)];
  const bitrate = o.audioBitrate ? `${o.audioBitrate}k` : null;
  switch (outputExt) {
    case 'mp3':
      args.push(
        '-c:a',
        'libmp3lame',
        ...(bitrate ? ['-b:a', bitrate] : ['-q:a', String(MP3_VBR[o.audioQuality])]),
      );
      break;
    case 'ogg':
      args.push(
        '-c:a',
        'libvorbis',
        ...(bitrate ? ['-b:a', bitrate] : ['-q:a', String(VORBIS_Q[o.audioQuality])]),
      );
      break;
    case 'opus':
      args.push('-c:a', 'libopus', '-b:a', bitrate ?? `${OPUS_KBPS[o.audioQuality]}k`);
      break;
    case 'm4a':
    case 'aac':
      args.push('-c:a', 'aac', '-b:a', bitrate ?? `${AAC_KBPS[o.audioQuality]}k`);
      break;
    case 'wav':
      args.push('-c:a', 'pcm_s16le');
      break;
    case 'aiff':
      args.push('-c:a', 'pcm_s16be');
      break;
    case 'flac':
      args.push('-c:a', 'flac');
      break;
  }
  // Opus only supports a few sample rates; ffmpeg picks the closest one.
  if (o.sampleRate && outputExt !== 'opus') args.push('-ar', String(o.sampleRate));
  if (o.channels !== 'keep') args.push('-ac', o.channels === 'mono' ? '1' : '2');
  return args;
}

function gifArgs(o: MediaOptions): string[] {
  // GIFs get huge quickly: without a choice, 12 fps and at most 480 px high.
  const fps = o.fps ?? 12;
  const height = o.resolution ?? 480;
  const graph =
    `fps=${fps},scale=-2:'min(ih,${height})':flags=lanczos,split[a][b];` +
    '[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3';
  return ['-filter_complex', graph, '-an', '-loop', '0'];
}

const WEBP_QUALITY: Record<QualityLevel, number> = { high: 85, balanced: 70, small: 50 };

function webpArgs(o: MediaOptions): string[] {
  // Like GIFs: without a choice 15 fps and at most 480 px high – but in full colour.
  const fps = o.fps ?? 15;
  const height = o.resolution ?? 480;
  return [
    '-vf',
    `fps=${fps},scale=-2:'min(ih,${height})':flags=lanczos`,
    '-an',
    '-c:v',
    'libwebp_anim',
    '-lossless',
    '0',
    '-quality',
    String(WEBP_QUALITY[o.videoQuality]),
    '-loop',
    '0',
  ];
}

/**
 * Cutting without re-encoding: the streams are copied as they are. Only
 * possible into the same format; the cut starts at the key frame before.
 */
function copyArgs(outputExt: string, o: MediaOptions): string[] {
  if (AUDIO_OUTPUTS.has(outputExt)) return ['-map', '0:a:0', '-c', 'copy'];
  return [
    '-map',
    '0:v:0',
    ...(o.removeAudio ? ['-an'] : ['-map', '0:a:0?']),
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
  ];
}

export interface FfmpegArgsInput {
  input: string;
  inputExt: string;
  output: string;
  outputExt: string;
  options: Record<string, unknown>;
  /** GPU to use for video, if one was detected (native only). */
  gpu?: GpuKind | null;
  /** Default: native ffmpeg on the server. */
  target?: FfmpegTarget;
  /**
   * Subtitles to burn into the picture: a track of the input, as text
   * (drawn with libass) or as pictures (DVD/Blu-ray, laid over the video).
   */
  burnSubtitles?: { track: number; picture: boolean } | { file: string } | null;
  /** "Remove silence": where the silence at the end begins (parseTrailingSilence). */
  trailingSilenceAt?: number | null;
  /** Channels of the input's sound (parseAudioChannels) – ffmpeg.wasm needs it for loudnorm. */
  audioChannels?: number | null;
}

/**
 * The input path inside a filter (subtitles=…). Only Conbert's own job paths
 * (UUIDs) get here; anything unusual is refused instead of escaped.
 */
export function filterPath(file: string): string {
  const unix = file.replace(/\\/g, '/');
  if (!/^[\w\-./:]+$/.test(unix)) throw new Error('ffmpeg: unexpected characters in a path');
  return `'${unix.replace(/:/g, '\\:')}'`;
}

/** Builds the complete ffmpeg argument list for one conversion. */
export function buildFfmpegArgs(req: FfmpegArgsInput): string[] {
  const o = resolveMediaOptions(req.options);
  // Compressing to a size: bitrates from the length of the input.
  let videoKbps: number | null = null;
  if (o.targetBytes && o.durationSeconds && req.outputExt !== 'gif') {
    const isVideo = VIDEO_OUTPUTS.has(req.outputExt);
    const rates = bitratesForTarget(o.targetBytes, o.durationSeconds, isVideo);
    if (isVideo) videoKbps = rates.videoKbps;
    o.audioBitrate = rates.audioKbps;
  }
  const demuxer = DEMUXER[req.inputExt];
  const muxer = MUXER[req.outputExt];
  if (!demuxer || !muxer)
    throw new Error(`ffmpeg: .${req.inputExt} → .${req.outputExt} not supported`);
  const target = req.target ?? 'native';
  const isVideoOut = VIDEO_OUTPUTS.has(req.outputExt);
  const gpu = isVideoOut && target === 'native' ? (req.gpu ?? null) : null;

  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'];
  // Native: progress lines on stdout. ffmpeg.wasm reports progress itself.
  if (target === 'native') args.push('-progress', 'pipe:1', '-nostats');
  if (gpu === 'vaapi' && o.useGpu) args.push('-vaapi_device', VAAPI_DEVICE);
  // Seeking before the input is fast; when re-encoding it is also frame-exact.
  if (o.trimStart) args.push('-ss', String(o.trimStart));
  args.push('-protocol_whitelist', 'file', '-f', demuxer, '-i', req.input);

  const burn = req.burnSubtitles ?? null;
  const sound: Sound = {
    silenceAt: req.trailingSilenceAt ?? null,
    channels: req.audioChannels ?? null,
    target,
  };
  // Changing the sound needs re-encoding: no fast copy.
  const copy =
    !burn &&
    !o.loudness &&
    !o.trimSilence &&
    o.trimFast &&
    req.inputExt === req.outputExt &&
    req.outputExt !== 'gif' &&
    req.outputExt in DEMUXER;
  if (copy) {
    args.push(...copyArgs(req.outputExt, o));
  } else if (req.outputExt === 'gif') {
    args.push(...gifArgs(o));
  } else if (req.outputExt === 'webp') {
    args.push(...webpArgs(o));
  } else if (AUDIO_OUTPUTS.has(req.outputExt)) {
    args.push(...audioOnlyArgs(req.outputExt, o, sound));
  } else {
    const video = videoArgs(req.outputExt, o, gpu, target, videoKbps);
    const filters = [...video.filters];
    if (burn && !('picture' in burn && burn.picture)) {
      // Text subtitles are drawn before the pixel format changes (GPU upload).
      // A cut starts at 0: shift to the film's own times for the subtitles.
      const start = o.trimStart ?? 0;
      const draw =
        'file' in burn
          ? `subtitles=filename=${filterPath(burn.file)}`
          : `subtitles=filename=${filterPath(req.input)}:si=${burn.track}`;
      const chain = start > 0 ? [`setpts=PTS+${start}/TB`, draw, 'setpts=PTS-STARTPTS'] : [draw];
      const at = filters.findIndex((f) => f.startsWith('format='));
      filters.splice(at < 0 ? filters.length : at, 0, ...chain);
    }
    if (burn && 'picture' in burn && burn.picture) {
      // Picture subtitles (DVD, Blu-ray): laid over the video like a second picture.
      const rest = filters.length > 0 ? `,${filters.join(',')}` : '';
      args.push(
        '-filter_complex',
        `[0:v:0][0:s:${burn.track}]overlay${rest}[v]`,
        '-map',
        '[v]',
        '-map',
        '0:a:0?',
        '-sn',
        '-dn',
        ...video.args,
      );
    } else {
      // First video and audio stream; subtitles and data tracks are left out.
      args.push('-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', ...video.args);
      if (filters.length > 0) args.push('-vf', filters.join(','));
    }
    args.push(...audioTrackArgs(req.outputExt, o, sound));
    if (req.outputExt === 'mp4' || req.outputExt === 'mov') args.push('-movflags', '+faststart');
  }
  // Videos often carry the recording location – strip it. Music keeps its
  // tags (artist, title, album) when converted between audio formats.
  const fromVideo = !AUDIO_OUTPUTS.has(req.inputExt) && req.inputExt !== 'wma';
  const strip = isVideoOut || req.outputExt === 'gif' || req.outputExt === 'webp' || fromVideo;
  if (target === 'wasm') {
    // ffmpeg.wasm 0.12 hangs when encoders or filters use several threads.
    args.push('-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1');
  }
  // Length of the part, counted from its start.
  if (o.trimEnd !== null)
    args.push('-t', String(Math.round((o.trimEnd - (o.trimStart ?? 0)) * 1000) / 1000));
  args.push('-map_metadata', strip ? '-1' : '0', '-f', muxer, req.output);
  return args;
}

/** Parses "out_time_us=1234567" style lines from `-progress pipe:1`. */
export function parseProgressSeconds(chunk: string): number | null {
  const matches = [...chunk.matchAll(/out_time_us=(\d+)/g)];
  const last = matches.at(-1)?.[1];
  return last ? Number(last) / 1_000_000 : null;
}
