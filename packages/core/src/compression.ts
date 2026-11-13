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

/** Levels a category offers – every category can aim for a size. */
export function compressLevels(category: Category | undefined): readonly CompressLevel[] {
  return category && COMPRESSIBLE.includes(category)
    ? ['max', 'balanced', 'small', 'target']
    : ['max', 'balanced', 'small'];
}

/**
 * How well a target size can be met: pictures, video and sound are tuned
 * until they fit ("exact"); other formats only have a few fixed levels, so
 * Conbert takes the best one that fits, or else the smallest ("levels").
 */
export function targetPrecision(category: Category | undefined): 'exact' | 'levels' {
  return category === 'image' || category === 'video' || category === 'audio' ? 'exact' : 'levels';
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
 * are searched with `compressToSize`.
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

/** One finished attempt of a size search. */
interface Sized<T> {
  result: T;
  size: number;
}

export interface SizeSearch<T> {
  /** Format of the result (decides how the size is reached). */
  outputExt: string;
  targetBytes: number;
  /**
   * Runs the compression once; `overrides` go on top of the options
   * (quality, scalePercent, targetBytes or a whole compression level).
   */
  encode: (overrides: Record<string, unknown>) => Promise<T>;
  sizeOf: (result: T) => number | Promise<number>;
  /** Called before each attempt (for a progress bar). */
  onTry?: (attempt: number, total: number) => void;
}

/** Results within this share of the target count as "close enough". */
const CLOSE_ENOUGH = 0.93;
/** Quality while shrinking the picture – lower looks blocky. */
const SCALE_QUALITY = 60;
/** Never shrink a picture below this share of its width. */
const MIN_SCALE_PERCENT = 3;

type Runner<T> = (overrides: Record<string, unknown>, total: number) => Promise<Sized<T>>;

/** The largest attempt that fits, else the smallest one. */
function pickBest<T>(attempts: Sized<T>[], targetBytes: number): Sized<T> {
  const fits = attempts.filter((a) => a.size <= targetBytes);
  return fits.length > 0
    ? fits.reduce((a, b) => (b.size > a.size ? b : a))
    : attempts.reduce((a, b) => (b.size < a.size ? b : a));
}

/**
 * Compresses so the result is at most `targetBytes` and as close to it as
 * the format allows:
 * - pictures: best quality that fits; if even the lowest quality is too
 *   big, the picture gets fewer pixels until it fits,
 * - video and sound: bitrates from the length, then up to two corrections
 *   if the encoder ended up too big (or far too small),
 * - everything else: the compression levels from best to smallest; the
 *   first one that fits wins.
 * If nothing fits, the smallest attempt is returned – the caller compares
 * its size with the target and says so.
 */
export async function compressToSize<T>(search: SizeSearch<T>): Promise<T> {
  const ext = normalizeExt(search.outputExt);
  const category = getFormat(ext)?.category;
  let tries = 0;
  const run: Runner<T> = async (overrides, total) => {
    search.onTry?.(tries++, total);
    const result = await search.encode(overrides);
    return { result, size: await search.sizeOf(result) };
  };
  const attempts =
    category === 'image'
      ? await imageAttempts(ext, search.targetBytes, run)
      : category === 'video' || category === 'audio'
        ? await mediaAttempts(search.targetBytes, run)
        : await levelAttempts(ext, search.targetBytes, run);
  return pickBest(attempts, search.targetBytes).result;
}

async function imageAttempts<T>(
  ext: string,
  targetBytes: number,
  run: Runner<T>,
): Promise<Sized<T>[]> {
  const attempts: Sized<T>[] = [];
  // Lossy formats: binary search on the quality first.
  const lossy = getFormat(ext)?.lossy === true;
  if (lossy) {
    const TRIES = 6;
    let low = 5;
    let high = 95;
    for (let i = 0; i < TRIES && low <= high; i++) {
      const quality = Math.round((low + high) / 2);
      const attempt = await run({ quality }, TRIES + 6);
      attempts.push(attempt);
      if (attempt.size <= targetBytes) low = quality + 1;
      else high = quality - 1;
    }
  } else {
    attempts.push(await run({}, 7));
  }
  if (attempts.some((a) => a.size <= targetBytes)) return attempts;

  // Still too big: fewer pixels. The size follows the pixel count, so the
  // width scales with the square root of the ratio.
  const quality = lossy ? { quality: SCALE_QUALITY } : {};
  const base = lossy ? await run(quality, 12) : attempts[0];
  if (!base) return attempts;
  if (lossy) {
    attempts.push(base);
    if (base.size <= targetBytes) return attempts;
  }
  let fits = 0; // largest scale known to fit
  let tooBig = 100; // smallest scale known to be too big
  let scale = 100;
  let lastSize = base.size;
  for (let i = 0; i < 6; i++) {
    let next = scale * Math.sqrt(targetBytes / lastSize) * 0.97;
    if (!(next > fits && next < tooBig)) next = (fits + tooBig) / 2;
    next = Math.max(MIN_SCALE_PERCENT, Math.round(next * 10) / 10);
    if (next === scale || next >= tooBig) break;
    scale = next;
    const attempt = await run({ ...quality, scalePercent: scale }, 12);
    attempts.push(attempt);
    lastSize = attempt.size;
    if (attempt.size <= targetBytes) {
      fits = scale;
      if (attempt.size >= targetBytes * CLOSE_ENOUGH) break;
    } else {
      tooBig = scale;
      if (scale <= MIN_SCALE_PERCENT) break;
    }
  }
  return attempts;
}

async function mediaAttempts<T>(targetBytes: number, run: Runner<T>): Promise<Sized<T>[]> {
  // The engines turn targetBytes into bitrates (bitratesForTarget).
  let last = await run({}, 3);
  const attempts = [last];
  let aim = targetBytes;
  for (let i = 0; i < 2; i++) {
    const tooBig = last.size > targetBytes;
    const tooSmall = last.size < targetBytes * 0.85;
    if (!tooBig && !tooSmall) break;
    // Bitrates follow the aim linearly, so correct by the miss.
    aim = Math.max(1, Math.round(aim * (targetBytes / Math.max(1, last.size)) * 0.98));
    const attempt = await run({ targetBytes: aim }, 3);
    attempts.push(attempt);
    // Same size again: a bitrate limit was hit, more tries won't help.
    if (Math.abs(attempt.size - last.size) <= last.size * 0.01) break;
    last = attempt;
  }
  return attempts;
}

async function levelAttempts<T>(
  ext: string,
  targetBytes: number,
  run: Runner<T>,
): Promise<Sized<T>[]> {
  const levels = sizeLadder(ext);
  const attempts: Sized<T>[] = [];
  for (const options of levels) {
    const attempt = await run(options, levels.length);
    attempts.push(attempt);
    if (attempt.size <= targetBytes) break;
  }
  return attempts;
}

/**
 * The compression levels of a format from best to smallest, without
 * duplicates (fonts and archives have fewer real steps).
 */
export function sizeLadder(outputExt: string): Record<string, unknown>[] {
  const seen = new Set<string>();
  const ladder: Record<string, unknown>[] = [];
  for (const level of ['max', 'balanced', 'small'] as const) {
    const options = compressionOptions(outputExt, { level, stripMetadata: true });
    const key = JSON.stringify(options);
    if (seen.has(key)) continue;
    seen.add(key);
    ladder.push(options);
  }
  return ladder;
}
