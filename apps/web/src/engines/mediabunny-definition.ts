import { AUDIO_OPTIONS, VIDEO_OPTIONS, type Engine, type FormatSupport } from '@conbert/core';

/**
 * mediabunny (WebCodecs): the browser's own, often hardware-accelerated
 * codecs. Very fast, and it copies streams without re-encoding when the
 * target container allows it. What the browser can encode differs per
 * browser and system – the worker checks at conversion time and reports
 * `errors.formatUnavailable`, so the router falls back to ffmpeg.wasm.
 */
const READ = ['mp4', 'mov', 'm4a', 'webm', 'mkv', 'mp3', 'wav', 'ogg', 'opus', 'flac', 'aac'];
const WRITE = ['mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'flac'];

export const MEDIABUNNY_FORMATS: FormatSupport[] = [...new Set([...READ, ...WRITE])].map((ext) => ({
  ext,
  canRead: READ.includes(ext),
  canWrite: WRITE.includes(ext),
}));

/** GPU, encoder speed and GIF-only options don't apply to WebCodecs. */
const UNSUPPORTED = new Set(['useGpu', 'encoderSpeed']);

export const MEDIABUNNY_META = {
  id: 'mediabunny',
  name: 'Mediabunny (Browser)',
  descriptionKey: 'engines.mediabunny.description',
  category: 'video',
  runtime: 'browser',
  formats: MEDIABUNNY_FORMATS,
  options: [...VIDEO_OPTIONS, ...AUDIO_OPTIONS].filter((o) => !UNSUPPORTED.has(o.key)),
  supportsCompression: true,
  supportsTrim: true,
  // Above ffmpeg.wasm (5): much faster where the browser has the codec.
  priority: 12,
} as const satisfies Omit<Engine, 'init' | 'status' | 'convert'>;
