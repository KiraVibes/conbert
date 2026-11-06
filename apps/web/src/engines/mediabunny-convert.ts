import {
  ALL_FORMATS,
  AdtsOutputFormat,
  BufferSource,
  BufferTarget,
  Conversion,
  FlacOutputFormat,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  type AudioCodec,
  type ConversionAudioOptions,
  type ConversionVideoOptions,
  type OutputFormat,
  type VideoCodec,
} from 'mediabunny';
import {
  ConversionError,
  bitratesForTarget,
  normalizeExt,
  readTrim,
  resolveMediaOptions,
  wantsAudioCleanup,
  type MediaOptions,
} from '@conbert/core';

type Progress = (percent: number, stage?: string) => void;

interface Target {
  format: OutputFormat;
  /** Audio-only targets drop the video track. */
  audioOnly: boolean;
  /** Codec the target needs; undefined lets mediabunny pick (and copy when possible). */
  audioCodec?: AudioCodec;
}

function outputTarget(ext: string): Target {
  switch (ext) {
    case 'mp4':
      return { format: new Mp4OutputFormat(), audioOnly: false };
    case 'mov':
      return { format: new MovOutputFormat(), audioOnly: false };
    case 'mkv':
      return { format: new MkvOutputFormat(), audioOnly: false };
    case 'webm':
      return { format: new WebMOutputFormat(), audioOnly: false };
    case 'm4a':
      return { format: new Mp4OutputFormat(), audioOnly: true, audioCodec: 'aac' };
    case 'aac':
      return { format: new AdtsOutputFormat(), audioOnly: true, audioCodec: 'aac' };
    case 'mp3':
      return { format: new Mp3OutputFormat(), audioOnly: true, audioCodec: 'mp3' };
    case 'wav':
      return { format: new WavOutputFormat(), audioOnly: true, audioCodec: 'pcm-s16' };
    case 'flac':
      return { format: new FlacOutputFormat(), audioOnly: true, audioCodec: 'flac' };
    // Browsers encode Opus, not Vorbis – so .ogg also gets Opus inside.
    case 'ogg':
    case 'opus':
      return { format: new OggOutputFormat(), audioOnly: true, audioCodec: 'opus' };
    default:
      throw new ConversionError('errors.formatUnavailable', `mediabunny can't write .${ext}`);
  }
}

const QUALITY: Record<MediaOptions['videoQuality'], Quality> = {
  high: new Quality('high'),
  balanced: new Quality('medium'),
  small: new Quality('low'),
};

const VIDEO_CODEC: Record<Exclude<MediaOptions['videoCodec'], 'auto'>, VideoCodec> = {
  h264: 'avc',
  h265: 'hevc',
  av1: 'av1',
  vp9: 'vp9',
};

/** Codecs of the input's first video and audio track (null = no such track). */
export interface SourceCodecs {
  video: string | null;
  audio: string | null;
  /** Height of the picture, so "max. 720p" never enlarges a smaller video. */
  videoHeight?: number | null;
}

/**
 * Maps Conbert's media options onto mediabunny. Streams are copied unchanged
 * whenever the target container accepts them (fast and lossless). mediabunny
 * re-encodes as soon as a quality is given, so the quality is only set when
 * re-encoding is needed anyway or wanted ("Small file", a fixed bitrate).
 */
export function mediabunnyOptions(
  outputExt: string,
  raw: Record<string, unknown>,
  source: SourceCodecs = { video: null, audio: null },
): { video: ConversionVideoOptions; audio: ConversionAudioOptions } {
  const ext = normalizeExt(outputExt);
  const o = resolveMediaOptions(raw);
  const target = outputTarget(ext);
  const format = target.format;
  // Compressing to a size: bitrates from the length of the input.
  const rates =
    o.targetBytes && o.durationSeconds
      ? bitratesForTarget(o.targetBytes, o.durationSeconds, !target.audioOnly)
      : null;
  const maxHeight =
    o.resolution && source.videoHeight && source.videoHeight <= o.resolution ? null : o.resolution;

  let video: ConversionVideoOptions = { discard: true };
  if (!target.audioOnly) {
    const codec = o.videoCodec === 'auto' ? undefined : VIDEO_CODEC[o.videoCodec];
    const copyable =
      source.video !== null &&
      (format.getSupportedVideoCodecs() as string[]).includes(source.video) &&
      (codec === undefined || codec === source.video) &&
      !maxHeight &&
      !o.fps &&
      !o.forceReencode &&
      !rates &&
      o.videoQuality !== 'small' &&
      // An exact cut needs a key frame at the start: re-encode.
      !(o.trimStart !== null && !o.trimFast);
    video = {
      ...(!copyable && {
        quality: rates ? new Quality(rates.videoKbps * 1000) : QUALITY[o.videoQuality],
      }),
      ...(maxHeight && { height: maxHeight, fit: 'contain' as const }),
      ...(o.fps && { frameRate: o.fps }),
      ...(codec && { codec }),
    };
  }

  let audio: ConversionAudioOptions = { discard: true };
  if (target.audioOnly || !o.removeAudio) {
    const codec = target.audioCodec;
    const copyable =
      source.audio !== null &&
      (format.getSupportedAudioCodecs() as string[]).includes(source.audio) &&
      (codec === undefined || codec === source.audio) &&
      !o.sampleRate &&
      o.channels === 'keep' &&
      o.audioBitrate === null &&
      !o.forceReencode &&
      !rates &&
      o.audioQuality !== 'small';
    const kbps = rates?.audioKbps ?? o.audioBitrate;
    audio = {
      ...(!copyable && {
        quality: kbps ? new Quality(kbps * 1000) : QUALITY[o.audioQuality],
      }),
      ...(codec && { codec }),
      ...(o.sampleRate && { sampleRate: o.sampleRate }),
      ...(o.channels !== 'keep' && { numberOfChannels: o.channels === 'mono' ? 1 : 2 }),
    };
  }
  return { video, audio };
}

/** Converts with mediabunny. Throws `errors.formatUnavailable` when the browser lacks a codec. */
export async function convertWithMediabunny(
  input: Uint8Array,
  inputExt: string,
  outputExt: string,
  options: Record<string, unknown>,
  onProgress: Progress,
): Promise<Uint8Array> {
  const ext = normalizeExt(outputExt);
  // Loudness and silence need ffmpeg's filters: ffmpeg.wasm takes over.
  if (wantsAudioCleanup(options)) {
    throw new ConversionError('errors.formatUnavailable', 'mediabunny: no audio filters');
  }
  const target = outputTarget(ext);
  const source = new Input({ formats: ALL_FORMATS, source: new BufferSource(input) });
  let codecs: SourceCodecs;
  try {
    const [videoTrack, audioTrack] = await Promise.all([
      source.getPrimaryVideoTrack(),
      source.getPrimaryAudioTrack(),
    ]);
    codecs = {
      video: videoTrack?.codec ?? null,
      audio: audioTrack?.codec ?? null,
      videoHeight: videoTrack?.displayHeight ?? null,
    };
  } catch (error) {
    throw new ConversionError(
      'errors.convertFailed',
      `${inputExt}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const { video, audio } = mediabunnyOptions(ext, options, codecs);
  const output = new Output({ format: target.format, target: new BufferTarget() });
  const trim = readTrim(options);

  let conversion: Conversion;
  try {
    conversion = await Conversion.init({
      input: source,
      output,
      video,
      audio,
      ...(trim && {
        trim: { start: trim.start, ...(trim.end !== null && { end: trim.end }) },
        // Fast: copy from the key frame before the start instead of re-encoding
        // the beginning (the part may start a little earlier).
        ...(trim.fast && { copy: { mode: 'preferred', boundaryPolicy: 'expand' } }),
      }),
      showWarnings: false,
    });
  } catch (error) {
    throw new ConversionError(
      'errors.convertFailed',
      `${inputExt}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!conversion.isValid || conversion.utilizedTracks.length === 0) {
    const reasons = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`);
    const noStream = conversion.discardedTracks.every((d) => d.reason === 'discarded_by_user');
    throw new ConversionError(
      noStream && reasons.length > 0 ? 'errors.noMatchingStream' : 'errors.formatUnavailable',
      reasons.join('; ') || 'no usable track',
    );
  }
  // A track the browser can't encode would silently go missing – let ffmpeg.wasm do it instead.
  const unencodable = conversion.discardedTracks.filter(
    (d) => d.reason === 'no_encodable_target_codec' || d.reason === 'undecodable_source_codec',
  );
  if (unencodable.length > 0) {
    throw new ConversionError(
      'errors.formatUnavailable',
      unencodable.map((d) => `${d.track.type}: ${d.reason}`).join('; '),
    );
  }

  conversion.onProgress = (p) => onProgress(Math.round(p * 100), 'converting');
  await conversion.execute();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new ConversionError('errors.convertFailed', 'mediabunny produced no output');
  return new Uint8Array(buffer);
}

/** Registers the bundled LAME encoder when the browser has no MP3 encoder (none do today). */
export async function ensureMp3Encoder(): Promise<void> {
  if (await canEncodeAudio('mp3')) return;
  const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
  registerMp3Encoder();
}
