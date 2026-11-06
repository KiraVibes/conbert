import type { Category } from './engine';
import { getFormat, normalizeExt } from './formats';

/**
 * Compression = the same (or a similar) format, just smaller. The levels
 * become ordinary engine options, so every engine that can convert can also
 * compress – with the same help texts.
 */

export type CompressLevel = 'max' | 'balanced' | 'small' | 'target';

export interface CompressSettings {
  level: CompressLevel;
  /** Desired size in bytes (level "target"). */
  targetBytes?: number;
  /** Remove EXIF/GPS from pictures (default on). */
  stripMetadata: boolean;
}

/** Categories Conbert can compress today. */
export const COMPRESSIBLE: readonly Category[] = [
  'image',
  'video',
  'audio',
  '3d',
  'pdf',
  'font',
  'archive',
  'vector',
];

/**
 * Uncompressed formats: re-encoding them in place changes nothing, so the
 * compress tab suggests a smaller format right away.
 */
const UNCOMPRESSED = new Set(['wav', 'aiff', 'bmp', 'tar']);

export function canCompressInPlace(ext: string): boolean {
  return !UNCOMPRESSED.has(normalizeExt(ext));
}

/** Smaller formats offered next to "same format" in the compress tab. */
export const COMPRESS_ALTERNATIVES: Partial<Record<Category, readonly string[]>> = {
  image: ['webp', 'avif', 'jpg'],
  video: ['mp4', 'webm'],
  audio: ['mp3', 'm4a', 'opus'],
  // Other 3D formats have no compression – GLB with compressed meshes is the small one.
  '3d': ['glb'],
  // WOFF2 is the most compact font format; 7Z packs tighter than ZIP.
  font: ['woff2'],
  archive: ['7z', 'zip'],
};

/** Levels a category offers (3D, PDF, fonts and archives can't hit an exact size). */
export function compressLevels(category: Category | undefined): readonly CompressLevel[] {
  return category && ['3d', 'pdf', 'font', 'archive', 'vector'].includes(category)
    ? ['max', 'balanced', 'small']
    : ['max', 'balanced', 'small', 'target'];
}

const IMAGE_QUALITY = { max: 90, balanced: 75, small: 55 } as const;
const MEDIA_LEVEL = { max: 'high', balanced: 'balanced', small: 'small' } as const;
const AUDIO_KBPS = { max: 192, balanced: 128, small: 96 } as const;

/** Lowest bitrates still worth producing. */
const MIN_VIDEO_KBPS = 80;
const MIN_AUDIO_KBPS = 32;
/** Container and rate-control slack: aim a little below the target. */
const SIZE_SAFETY = 0.92;

export interface TargetBitrates {
  videoKbps: number;
  audioKbps: number;
}

/**
 * Bitrates so a video (or song) of `seconds` ends up at about `targetBytes`.
 * The sound gets a sensible share, the picture the rest.
 */
export function bitratesForTarget(
  targetBytes: number,
  seconds: number,
  hasVideo: boolean,
): TargetBitrates {
  const totalKbps = Math.max(1, (targetBytes * 8 * SIZE_SAFETY) / 1000 / Math.max(seconds, 0.1));
  if (!hasVideo) {
    return {
      videoKbps: 0,
      audioKbps: Math.round(Math.min(320, Math.max(MIN_AUDIO_KBPS, totalKbps))),
    };
  }
  const audioKbps = totalKbps < 400 ? 48 : totalKbps < 1200 ? 96 : 128;
  return {
    videoKbps: Math.round(Math.max(MIN_VIDEO_KBPS, totalKbps - audioKbps)),
    audioKbps,
  };
}

/**
 * Engine options for a compression. For "target" with video/audio the
 * engines turn `targetBytes` + `durationSeconds` into bitrates; pictures
 * are searched with `findQualityForSize`.
 */
export function compressionOptions(
  outputExt: string,
  settings: CompressSettings,
): Record<string, unknown> {
  const ext = normalizeExt(outputExt);
  const category = getFormat(ext)?.category;
  const level = settings.level === 'target' ? 'balanced' : settings.level;
  const options: Record<string, unknown> = { forceReencode: true };
  if (settings.level === 'target' && settings.targetBytes)
    options['targetBytes'] = settings.targetBytes;

  switch (category) {
    case 'image':
      options['quality'] = IMAGE_QUALITY[level];
      options['effort'] = level === 'max' ? 'balanced' : 'small';
      options['stripMetadata'] = settings.stripMetadata;
      // PNG has no quality – fewer colours are what makes it small.
      if (ext === 'png' && (level === 'small' || settings.level === 'target'))
        options['pngPalette'] = true;
      break;
    case 'video':
      options['videoQuality'] = MEDIA_LEVEL[level];
      options['audioBitrate'] = String(AUDIO_KBPS[level]);
      if (level === 'small') options['resolution'] = '720';
      break;
    case 'audio':
      options['audioQuality'] = MEDIA_LEVEL[level];
      options['audioBitrate'] = String(AUDIO_KBPS[level]);
      break;
    case '3d':
      // Meshopt keeps full precision; Draco is smaller but lossy and slower to load.
      options['meshCompression'] = level === 'small' ? 'draco' : 'meshopt';
      options['textureFormat'] = level === 'max' ? 'keep' : 'webp';
      options['textureSize'] = level === 'max' ? 'keep' : level === 'balanced' ? '2048' : '1024';
      options['simplify'] = level === 'small' ? '0.5' : '1';
      break;
    case 'pdf':
      // Lossless restructuring, or pictures reduced to e-book (150 dpi) / screen (72 dpi) quality.
      options['pdfQuality'] =
        level === 'max' ? 'lossless' : level === 'balanced' ? 'ebook' : 'screen';
      break;
    case 'font':
      // Only the smallest level drops rare characters; WOFF2 does the rest.
      options['fontSubset'] = level === 'small' ? 'latin-ext' : 'all';
      break;
    case 'archive':
      options['archiveLevel'] = 'max';
      break;
    case 'vector':
      // SVG: fewer decimal places in the coordinates (svgo).
      options['svgPrecision'] = level === 'max' ? 'high' : level;
      options['svgKeepEditorData'] = false;
      break;
    default:
      break;
  }
  return options;
}

/**
 * Finds the best picture quality that still fits `targetBytes` (binary
 * search, a handful of tries). Returns the largest result that fits, or the
 * smallest one if nothing fits.
 */
export async function findQualityForSize<T>(
  encode: (quality: number) => Promise<T>,
  sizeOf: (result: T) => number,
  targetBytes: number,
  onTry?: (attempt: number, total: number) => void,
): Promise<T> {
  const TRIES = 6;
  let low = 5;
  let high = 95;
  let best: { result: T; size: number } | null = null;
  let smallest: { result: T; size: number } | null = null;
  for (let attempt = 0; attempt < TRIES && low <= high; attempt++) {
    onTry?.(attempt, TRIES);
    const quality = Math.round((low + high) / 2);
    const result = await encode(quality);
    const size = sizeOf(result);
    if (!smallest || size < smallest.size) smallest = { result, size };
    if (size <= targetBytes) {
      if (!best || size > best.size) best = { result, size };
      low = quality + 1;
    } else {
      high = quality - 1;
    }
  }
  const pick = best ?? smallest;
  if (!pick) throw new Error('findQualityForSize: no attempt');
  return pick.result;
}
