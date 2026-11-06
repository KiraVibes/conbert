import type { EngineOption } from '../engine';
import { readTrim } from '../trim';

/**
 * Audio and video options shared by ffmpeg (server), ffmpeg.wasm and
 * mediabunny (browser): same choices and help texts everywhere.
 */

export const LOSSY_AUDIO_TARGETS = ['mp3', 'ogg', 'opus', 'm4a', 'aac'];
export const AUDIO_TARGETS = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'aiff'];
export const VIDEO_TARGETS = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'mpg'];
/** Moving pictures made from a video (ffmpeg). */
export const ANIMATION_TARGETS = ['gif', 'webp'];

const level = (prefix: string) => [
  { value: 'high', labelKey: `options.${prefix}.high`, helpKey: `options.${prefix}.highHelp` },
  {
    value: 'balanced',
    labelKey: `options.${prefix}.balanced`,
    helpKey: `options.${prefix}.balancedHelp`,
  },
  { value: 'small', labelKey: `options.${prefix}.small`, helpKey: `options.${prefix}.smallHelp` },
];

export const AUDIO_OPTIONS: EngineOption[] = [
  {
    key: 'audioQuality',
    labelKey: 'options.audioQuality.label',
    helpKey: 'options.audioQuality.help',
    effectKey: 'options.audioQuality.effect',
    advanced: false,
    type: 'select',
    default: 'balanced',
    choices: level('audioQuality'),
    appliesTo: LOSSY_AUDIO_TARGETS,
  },
  {
    key: 'audioBitrate',
    labelKey: 'options.audioBitrate.label',
    helpKey: 'options.audioBitrate.help',
    effectKey: 'options.audioBitrate.effect',
    advanced: true,
    type: 'select',
    default: 'auto',
    choices: ['auto', '64', '96', '128', '160', '192', '256', '320'].map((value) => ({
      value,
      labelKey:
        value === 'auto' ? 'options.audioBitrate.auto' : `options.audioBitrate.kbps${value}`,
    })),
    appliesTo: [...LOSSY_AUDIO_TARGETS, ...VIDEO_TARGETS],
  },
  {
    key: 'sampleRate',
    labelKey: 'options.sampleRate.label',
    helpKey: 'options.sampleRate.help',
    advanced: true,
    type: 'select',
    default: 'keep',
    choices: [
      { value: 'keep', labelKey: 'options.sampleRate.keep' },
      { value: '48000', labelKey: 'options.sampleRate.hz48000' },
      { value: '44100', labelKey: 'options.sampleRate.hz44100' },
      { value: '22050', labelKey: 'options.sampleRate.hz22050' },
    ],
    appliesTo: AUDIO_TARGETS,
  },
  {
    key: 'channels',
    labelKey: 'options.channels.label',
    helpKey: 'options.channels.help',
    advanced: true,
    type: 'select',
    default: 'keep',
    choices: [
      { value: 'keep', labelKey: 'options.channels.keep' },
      { value: 'stereo', labelKey: 'options.channels.stereo' },
      { value: 'mono', labelKey: 'options.channels.mono', helpKey: 'options.channels.monoHelp' },
    ],
    appliesTo: AUDIO_TARGETS,
  },
];

/** Loudness targets in LUFS (EBU R128 measure) and the peak limit in dBTP. */
export const LOUDNESS_TARGETS = {
  music: { lufs: -14, peak: -1 },
  speech: { lufs: -16, peak: -1.5 },
  broadcast: { lufs: -23, peak: -1 },
} as const;
export type LoudnessTarget = keyof typeof LOUDNESS_TARGETS;

/** Cleaning up the sound (ffmpeg only; mediabunny hands these over to ffmpeg.wasm). */
export const AUDIO_CLEANUP_OPTIONS: EngineOption[] = [
  {
    key: 'loudness',
    labelKey: 'options.loudness.label',
    helpKey: 'options.loudness.help',
    effectKey: 'options.loudness.effect',
    advanced: true,
    type: 'select',
    default: 'off',
    choices: ['off', ...Object.keys(LOUDNESS_TARGETS)].map((value) => ({
      value,
      labelKey: `options.loudness.${value}`,
      helpKey: `options.loudness.${value}Help`,
    })),
    appliesTo: [...AUDIO_TARGETS, ...VIDEO_TARGETS],
  },
  {
    key: 'trimSilence',
    labelKey: 'options.trimSilence.label',
    helpKey: 'options.trimSilence.help',
    effectKey: 'options.trimSilence.effect',
    advanced: true,
    type: 'boolean',
    default: false,
    // Only sound files: cutting the sound of a video would put it out of step.
    appliesTo: AUDIO_TARGETS,
  },
];
AUDIO_OPTIONS.push(...AUDIO_CLEANUP_OPTIONS);

/** Whether a sound clean-up option is switched on. */
export function wantsAudioCleanup(raw: Record<string, unknown>): boolean {
  const o = resolveMediaOptions(raw);
  return o.loudness !== null || o.trimSilence;
}

export const VIDEO_OPTIONS: EngineOption[] = [
  {
    key: 'videoQuality',
    labelKey: 'options.videoQuality.label',
    helpKey: 'options.videoQuality.help',
    effectKey: 'options.videoQuality.effect',
    advanced: false,
    type: 'select',
    default: 'balanced',
    choices: level('videoQuality'),
    appliesTo: [...VIDEO_TARGETS, 'webp'],
  },
  {
    key: 'resolution',
    labelKey: 'options.resolution.label',
    helpKey: 'options.resolution.help',
    effectKey: 'options.resolution.effect',
    advanced: true,
    type: 'select',
    default: 'keep',
    choices: ['keep', '2160', '1440', '1080', '720', '480', '360'].map((value) => ({
      value,
      labelKey: `options.resolution.r${value}`,
    })),
    appliesTo: [...VIDEO_TARGETS, ...ANIMATION_TARGETS],
  },
  {
    key: 'fps',
    labelKey: 'options.fps.label',
    helpKey: 'options.fps.help',
    advanced: true,
    type: 'select',
    default: 'keep',
    choices: ['keep', '60', '30', '24', '15', '10'].map((value) => ({
      value,
      labelKey: `options.fps.f${value}`,
    })),
    appliesTo: [...VIDEO_TARGETS, ...ANIMATION_TARGETS],
  },
  {
    key: 'videoCodec',
    labelKey: 'options.videoCodec.label',
    helpKey: 'options.videoCodec.help',
    advanced: true,
    type: 'select',
    default: 'auto',
    choices: [
      {
        value: 'auto',
        labelKey: 'options.videoCodec.auto',
        helpKey: 'options.videoCodec.autoHelp',
      },
      {
        value: 'h264',
        labelKey: 'options.videoCodec.h264',
        helpKey: 'options.videoCodec.h264Help',
      },
      {
        value: 'h265',
        labelKey: 'options.videoCodec.h265',
        helpKey: 'options.videoCodec.h265Help',
      },
      { value: 'av1', labelKey: 'options.videoCodec.av1', helpKey: 'options.videoCodec.av1Help' },
      { value: 'vp9', labelKey: 'options.videoCodec.vp9', helpKey: 'options.videoCodec.vp9Help' },
    ],
    appliesTo: ['mp4', 'mkv', 'mov', 'webm'],
  },
  {
    key: 'encoderSpeed',
    labelKey: 'options.encoderSpeed.label',
    helpKey: 'options.encoderSpeed.help',
    advanced: true,
    type: 'select',
    default: 'balanced',
    choices: [
      { value: 'fast', labelKey: 'options.encoderSpeed.fast' },
      { value: 'balanced', labelKey: 'options.encoderSpeed.balanced' },
      { value: 'small', labelKey: 'options.encoderSpeed.small' },
    ],
    appliesTo: VIDEO_TARGETS,
  },
  {
    key: 'removeAudio',
    labelKey: 'options.removeAudio.label',
    helpKey: 'options.removeAudio.help',
    advanced: true,
    type: 'boolean',
    default: false,
    appliesTo: VIDEO_TARGETS,
  },
  {
    key: 'useGpu',
    labelKey: 'options.useGpu.label',
    helpKey: 'options.useGpu.help',
    effectKey: 'options.useGpu.effect',
    advanced: true,
    type: 'boolean',
    default: true,
    appliesTo: VIDEO_TARGETS,
  },
];

export type QualityLevel = 'high' | 'balanced' | 'small';

export interface MediaOptions {
  audioQuality: QualityLevel;
  /** kbps, or null for automatic. */
  audioBitrate: number | null;
  sampleRate: number | null;
  channels: 'keep' | 'stereo' | 'mono';
  /** Even out the loudness (loudnorm), or null to leave it. */
  loudness: LoudnessTarget | null;
  /** Cut silence at the start and end (sound files only). */
  trimSilence: boolean;
  videoQuality: QualityLevel;
  /** Maximum height in pixels, or null to keep. */
  resolution: number | null;
  fps: number | null;
  videoCodec: 'auto' | 'h264' | 'h265' | 'av1' | 'vp9';
  encoderSpeed: 'fast' | 'balanced' | 'small';
  removeAudio: boolean;
  useGpu: boolean;
  /** Compressing: never just copy the streams (mediabunny). */
  forceReencode: boolean;
  /** Compressing to a size: wanted bytes and the length of the input. */
  targetBytes: number | null;
  durationSeconds: number | null;
  /** Only a part (see trim.ts): start and end in seconds. */
  trimStart: number | null;
  trimEnd: number | null;
  /** Cut without re-encoding (same format in and out). */
  trimFast: boolean;
}

const isLevel = (v: unknown): v is QualityLevel =>
  v === 'high' || v === 'balanced' || v === 'small';
const isLoudness = (v: unknown): v is LoudnessTarget =>
  typeof v === 'string' && Object.hasOwn(LOUDNESS_TARGETS, v);
const positiveInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const positiveNumber = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Validates raw option values from the UI and fills in defaults. */
export function resolveMediaOptions(raw: Record<string, unknown>): MediaOptions {
  const codec = raw['videoCodec'];
  const speed = raw['encoderSpeed'];
  const channels = raw['channels'];
  const trim = readTrim(raw);
  return {
    audioQuality: isLevel(raw['audioQuality']) ? raw['audioQuality'] : 'balanced',
    audioBitrate: positiveInt(raw['audioBitrate']),
    sampleRate: positiveInt(raw['sampleRate']),
    channels: channels === 'stereo' || channels === 'mono' ? channels : 'keep',
    loudness: isLoudness(raw['loudness']) ? raw['loudness'] : null,
    trimSilence: raw['trimSilence'] === true,
    videoQuality: isLevel(raw['videoQuality']) ? raw['videoQuality'] : 'balanced',
    resolution: positiveInt(raw['resolution']),
    fps: positiveInt(raw['fps']),
    videoCodec:
      codec === 'h264' || codec === 'h265' || codec === 'av1' || codec === 'vp9' ? codec : 'auto',
    encoderSpeed: speed === 'fast' || speed === 'small' ? speed : 'balanced',
    removeAudio: raw['removeAudio'] === true,
    useGpu: raw['useGpu'] !== false,
    forceReencode: raw['forceReencode'] === true,
    targetBytes: positiveInt(raw['targetBytes']),
    durationSeconds: positiveNumber(raw['durationSeconds']),
    trimStart: trim?.start || null,
    trimEnd: trim?.end ?? null,
    trimFast: trim?.fast === true,
  };
}
