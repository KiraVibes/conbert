import type { Category } from './engine';

/**
 * Central format registry – one entry per file extension. All texts are i18n
 * keys; the actual (German/English) texts live in @conbert/i18n.
 */
export interface FormatInfo {
  /** Canonical extension, lowercase, without dot. */
  ext: string;
  /** Other spellings that mean the same format ('jpeg' → 'jpg'). */
  aliases?: string[];
  /** Category belongs to the format, not to the engine. */
  category: Category;
  mime: string;
  /** "JPEG image" */
  nameKey: string;
  /** One sentence: what is this? */
  summaryKey: string;
  /** What is it good for? ("photos, WhatsApp, web") */
  goodForKey: string;
  /** What is it not good for? ("logos with transparency") */
  badForKey?: string;
  /** Lossy compression? */
  lossy: boolean;
  supportsTransparency?: boolean;
  supportsAnimation?: boolean;
  /** Which programs open it? ("any browser, Windows Photos") */
  openWithKey?: string;
}

interface FormatSpec {
  ext: string;
  aliases?: string[];
  category: Category;
  mime: string;
  lossy: boolean;
  supportsTransparency?: boolean;
  supportsAnimation?: boolean;
  hasBadFor?: boolean;
  hasOpenWith?: boolean;
}

/** Builds a FormatInfo with i18n keys following the `formats.<ext>.*` convention. */
function defineFormat(spec: FormatSpec): FormatInfo {
  const base = `formats.${spec.ext}`;
  const info: FormatInfo = {
    ext: spec.ext,
    category: spec.category,
    mime: spec.mime,
    nameKey: `${base}.name`,
    summaryKey: `${base}.summary`,
    goodForKey: `${base}.goodFor`,
    lossy: spec.lossy,
  };
  if (spec.aliases) info.aliases = spec.aliases;
  if (spec.supportsTransparency !== undefined)
    info.supportsTransparency = spec.supportsTransparency;
  if (spec.supportsAnimation !== undefined) info.supportsAnimation = spec.supportsAnimation;
  if (spec.hasBadFor !== false) info.badForKey = `${base}.badFor`;
  if (spec.hasOpenWith !== false) info.openWithKey = `${base}.openWith`;
  return info;
}

export const FORMATS: readonly FormatInfo[] = [
  // --- Images ---
  defineFormat({
    ext: 'jpg',
    aliases: ['jpeg', 'jpe', 'jfif'],
    category: 'image',
    mime: 'image/jpeg',
    lossy: true,
    supportsTransparency: false,
    supportsAnimation: false,
  }),
  defineFormat({
    ext: 'png',
    category: 'image',
    mime: 'image/png',
    lossy: false,
    supportsTransparency: true,
    supportsAnimation: false,
  }),
  defineFormat({
    ext: 'webp',
    category: 'image',
    mime: 'image/webp',
    lossy: true,
    supportsTransparency: true,
    supportsAnimation: true,
  }),
  defineFormat({
    ext: 'avif',
    category: 'image',
    mime: 'image/avif',
    lossy: true,
    supportsTransparency: true,
    supportsAnimation: false,
  }),
  defineFormat({
    ext: 'gif',
    category: 'image',
    mime: 'image/gif',
    lossy: false,
    supportsTransparency: true,
    supportsAnimation: true,
  }),
  defineFormat({
    ext: 'tiff',
    aliases: ['tif'],
    category: 'image',
    mime: 'image/tiff',
    lossy: false,
    supportsTransparency: true,
    supportsAnimation: false,
  }),
  defineFormat({
    ext: 'jxl',
    category: 'image',
    mime: 'image/jxl',
    lossy: true,
    supportsTransparency: true,
    supportsAnimation: false,
  }),
  defineFormat({
    ext: 'heic',
    aliases: ['heif'],
    category: 'image',
    mime: 'image/heic',
    lossy: true,
    supportsTransparency: true,
    supportsAnimation: false,
  }),
  defineFormat({
    ext: 'bmp',
    aliases: ['dib'],
    category: 'image',
    mime: 'image/bmp',
    lossy: false,
    supportsTransparency: false,
    supportsAnimation: false,
  }),
  defineFormat({
    ext: 'ico',
    category: 'image',
    mime: 'image/x-icon',
    lossy: false,
    supportsTransparency: true,
    supportsAnimation: false,
  }),
  defineFormat({
    ext: 'tga',
    category: 'image',
    mime: 'image/x-tga',
    lossy: false,
    supportsTransparency: true,
    supportsAnimation: false,
  }),
  defineFormat({
    ext: 'psd',
    category: 'image',
    mime: 'image/vnd.adobe.photoshop',
    lossy: false,
    supportsTransparency: true,
    supportsAnimation: false,
  }),
  defineFormat({
    ext: 'jp2',
    aliases: ['j2k', 'jpf'],
    category: 'image',
    mime: 'image/jp2',
    lossy: true,
    supportsTransparency: true,
    supportsAnimation: false,
  }),
  // --- Vector ---
  defineFormat({
    ext: 'svg',
    category: 'vector',
    mime: 'image/svg+xml',
    lossy: false,
    supportsTransparency: true,
    supportsAnimation: false,
  }),
  // --- Audio ---
  defineFormat({
    ext: 'mp3',
    category: 'audio',
    mime: 'audio/mpeg',
    lossy: true,
  }),
  defineFormat({
    ext: 'wav',
    aliases: ['wave'],
    category: 'audio',
    mime: 'audio/wav',
    lossy: false,
  }),
  defineFormat({
    ext: 'flac',
    category: 'audio',
    mime: 'audio/flac',
    lossy: false,
  }),
  defineFormat({
    ext: 'ogg',
    aliases: ['oga'],
    category: 'audio',
    mime: 'audio/ogg',
    lossy: true,
  }),
  defineFormat({
    ext: 'opus',
    category: 'audio',
    mime: 'audio/opus',
    lossy: true,
  }),
  defineFormat({
    ext: 'm4a',
    category: 'audio',
    mime: 'audio/mp4',
    lossy: true,
  }),
  defineFormat({
    ext: 'aac',
    category: 'audio',
    mime: 'audio/aac',
    lossy: true,
  }),
  defineFormat({
    ext: 'aiff',
    aliases: ['aif'],
    category: 'audio',
    mime: 'audio/aiff',
    lossy: false,
  }),
  defineFormat({
    ext: 'wma',
    category: 'audio',
    mime: 'audio/x-ms-wma',
    lossy: true,
  }),
  // --- Video ---
  defineFormat({
    ext: 'mp4',
    aliases: ['m4v'],
    category: 'video',
    mime: 'video/mp4',
    lossy: true,
  }),
  defineFormat({
    ext: 'webm',
    category: 'video',
    mime: 'video/webm',
    lossy: true,
  }),
  defineFormat({
    ext: 'mkv',
    category: 'video',
    mime: 'video/x-matroska',
    lossy: true,
  }),
  defineFormat({
    ext: 'mov',
    aliases: ['qt'],
    category: 'video',
    mime: 'video/quicktime',
    lossy: true,
  }),
  defineFormat({
    ext: 'avi',
    category: 'video',
    mime: 'video/x-msvideo',
    lossy: true,
  }),
  defineFormat({
    ext: 'wmv',
    aliases: ['asf'],
    category: 'video',
    mime: 'video/x-ms-wmv',
    lossy: true,
  }),
  defineFormat({
    ext: 'mpg',
    aliases: ['mpeg'],
    category: 'video',
    mime: 'video/mpeg',
    lossy: true,
  }),
  // A ready-to-play Game Boy Advance module (player + video), output only.
  defineFormat({
    ext: 'gba',
    category: 'video',
    mime: 'application/x-gba-rom',
    lossy: true,
  }),
  // --- MIDI & soundfonts ---
  defineFormat({
    ext: 'mid',
    aliases: ['midi', 'smf'],
    category: 'midi',
    mime: 'audio/midi',
    lossy: false,
  }),
  defineFormat({
    ext: 'sf2',
    category: 'audio',
    mime: 'audio/x-soundfont',
    lossy: false,
  }),
  defineFormat({
    ext: 'sf3',
    category: 'audio',
    mime: 'audio/x-soundfont',
    lossy: true,
  }),
  defineFormat({
    ext: 'dls',
    category: 'audio',
    mime: 'audio/dls',
    lossy: false,
  }),
  // --- Documents ---
  defineFormat({
    ext: 'md',
    aliases: ['markdown'],
    category: 'document',
    mime: 'text/markdown',
    lossy: false,
  }),
  defineFormat({
    ext: 'html',
    aliases: ['htm', 'xhtml'],
    category: 'document',
    mime: 'text/html',
    lossy: false,
  }),
  defineFormat({
    ext: 'docx',
    category: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    lossy: false,
  }),
  defineFormat({
    ext: 'odt',
    category: 'document',
    mime: 'application/vnd.oasis.opendocument.text',
    lossy: false,
  }),
  defineFormat({
    ext: 'rtf',
    category: 'document',
    mime: 'application/rtf',
    lossy: false,
  }),
  defineFormat({
    ext: 'txt',
    aliases: ['text'],
    category: 'document',
    mime: 'text/plain',
    lossy: false,
  }),
  defineFormat({
    ext: 'srt',
    category: 'document',
    mime: 'application/x-subrip',
    lossy: false,
    hasOpenWith: true,
  }),
  defineFormat({
    ext: 'lrc',
    category: 'document',
    mime: 'application/x-lrc',
    lossy: false,
    hasOpenWith: true,
  }),
  defineFormat({
    ext: 'vtt',
    category: 'document',
    mime: 'text/vtt',
    lossy: false,
    hasOpenWith: true,
  }),
  defineFormat({
    ext: 'ass',
    aliases: ['ssa'],
    category: 'document',
    mime: 'text/x-ssa',
    lossy: false,
    hasOpenWith: true,
  }),
  defineFormat({
    ext: 'rst',
    category: 'document',
    mime: 'text/x-rst',
    lossy: false,
  }),
  defineFormat({
    ext: 'tex',
    aliases: ['latex'],
    category: 'document',
    mime: 'application/x-tex',
    lossy: false,
  }),
  defineFormat({
    ext: 'org',
    category: 'document',
    mime: 'text/x-org',
    lossy: false,
  }),
  defineFormat({
    ext: 'epub',
    category: 'ebook',
    mime: 'application/epub+zip',
    lossy: false,
  }),
  // --- Office (LibreOffice) ---
  defineFormat({
    ext: 'doc',
    category: 'document',
    mime: 'application/msword',
    lossy: false,
  }),
  defineFormat({
    ext: 'pptx',
    category: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    lossy: false,
  }),
  defineFormat({
    ext: 'ppt',
    category: 'document',
    mime: 'application/vnd.ms-powerpoint',
    lossy: false,
  }),
  defineFormat({
    ext: 'odp',
    category: 'document',
    mime: 'application/vnd.oasis.opendocument.presentation',
    lossy: false,
  }),
  // --- Spreadsheets and data ---
  defineFormat({
    ext: 'xlsx',
    category: 'data',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    lossy: false,
  }),
  defineFormat({
    ext: 'xls',
    category: 'data',
    mime: 'application/vnd.ms-excel',
    lossy: false,
  }),
  defineFormat({
    ext: 'ods',
    category: 'data',
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
    lossy: false,
  }),
  defineFormat({
    ext: 'csv',
    category: 'data',
    mime: 'text/csv',
    lossy: false,
  }),
  defineFormat({
    ext: 'json',
    category: 'data',
    mime: 'application/json',
    lossy: false,
  }),
  defineFormat({
    ext: 'yaml',
    aliases: ['yml'],
    category: 'data',
    mime: 'application/yaml',
    lossy: false,
  }),
  defineFormat({
    ext: 'toml',
    category: 'data',
    mime: 'application/toml',
    lossy: false,
  }),
  defineFormat({
    ext: 'xml',
    category: 'data',
    mime: 'application/xml',
    lossy: false,
  }),
  // --- E-books (Calibre) ---
  defineFormat({
    ext: 'mobi',
    category: 'ebook',
    mime: 'application/x-mobipocket-ebook',
    lossy: false,
  }),
  defineFormat({
    ext: 'azw3',
    category: 'ebook',
    mime: 'application/vnd.amazon.ebook',
    lossy: false,
  }),
  defineFormat({
    ext: 'fb2',
    category: 'ebook',
    mime: 'application/x-fictionbook+xml',
    lossy: false,
  }),
  // --- Archives ---
  defineFormat({
    ext: 'zip',
    category: 'archive',
    mime: 'application/zip',
    lossy: false,
  }),
  defineFormat({
    ext: '7z',
    category: 'archive',
    mime: 'application/x-7z-compressed',
    lossy: false,
  }),
  defineFormat({
    ext: 'tar',
    category: 'archive',
    mime: 'application/x-tar',
    lossy: false,
  }),
  defineFormat({
    ext: 'tgz',
    aliases: ['gz'],
    category: 'archive',
    mime: 'application/gzip',
    lossy: false,
  }),
  defineFormat({
    ext: 'rar',
    category: 'archive',
    mime: 'application/vnd.rar',
    lossy: false,
  }),
  // --- Fonts ---
  defineFormat({
    ext: 'ttf',
    category: 'font',
    mime: 'font/ttf',
    lossy: false,
  }),
  defineFormat({
    ext: 'otf',
    category: 'font',
    mime: 'font/otf',
    lossy: false,
  }),
  defineFormat({
    ext: 'woff',
    category: 'font',
    mime: 'font/woff',
    lossy: false,
  }),
  defineFormat({
    ext: 'woff2',
    category: 'font',
    mime: 'font/woff2',
    lossy: false,
  }),
  // --- 3D models ---
  defineFormat({
    ext: 'glb',
    category: '3d',
    mime: 'model/gltf-binary',
    lossy: false,
  }),
  defineFormat({
    ext: 'gltf',
    category: '3d',
    mime: 'model/gltf+json',
    lossy: false,
  }),
  defineFormat({
    ext: 'obj',
    category: '3d',
    mime: 'model/obj',
    lossy: false,
  }),
  defineFormat({
    ext: 'stl',
    category: '3d',
    mime: 'model/stl',
    lossy: false,
  }),
  defineFormat({
    ext: 'ply',
    category: '3d',
    mime: 'application/x-ply',
    lossy: false,
  }),
  defineFormat({
    ext: 'fbx',
    category: '3d',
    mime: 'application/octet-stream',
    lossy: false,
  }),
  defineFormat({
    ext: 'dae',
    category: '3d',
    mime: 'model/vnd.collada+xml',
    lossy: false,
  }),
  defineFormat({
    ext: '3ds',
    category: '3d',
    mime: 'application/x-3ds',
    lossy: false,
  }),
  defineFormat({
    ext: '3mf',
    category: '3d',
    mime: 'model/3mf',
    lossy: false,
  }),
  defineFormat({
    ext: 'x3d',
    category: '3d',
    mime: 'model/x3d+xml',
    lossy: false,
  }),
  defineFormat({
    ext: 'usdz',
    category: '3d',
    mime: 'model/vnd.usdz+zip',
    lossy: false,
  }),
  // Read and written by Blender only (installed by the admin on demand).
  defineFormat({
    ext: 'blend',
    category: '3d',
    mime: 'application/x-blender',
    lossy: false,
  }),
  defineFormat({
    ext: 'usd',
    category: '3d',
    mime: 'model/vnd.usd',
    lossy: false,
  }),
  defineFormat({
    ext: 'usdc',
    category: '3d',
    mime: 'model/vnd.usd',
    lossy: false,
  }),
  defineFormat({
    ext: 'usda',
    category: '3d',
    mime: 'model/vnd.usda',
    lossy: false,
  }),
  defineFormat({
    ext: 'abc',
    category: '3d',
    mime: 'application/octet-stream',
    lossy: false,
  }),
  // --- PDF (preview now; conversions follow in phase 6) ---
  defineFormat({
    ext: 'pdf',
    category: 'pdf',
    mime: 'application/pdf',
    lossy: false,
  }),
];

/**
 * Containers that hold different kinds of content. Magic bytes only reveal
 * the container (e.g. ASF for both WMV and WMA), so a file name naming a
 * sibling format is more precise.
 */
const CONTAINER_SIBLINGS: readonly (readonly string[])[] = [
  ['wmv', 'wma'],
  ['mp4', 'm4a', 'mov'],
  ['ogg', 'opus'],
  ['mkv', 'webm'],
  // ZIP-, XML- and OLE-based formats: the content says zip/xml/cfb, the name says more.
  ['zip', '3mf', 'usdz'],
  // SVGs from Inkscape/Illustrator start with <?xml …?> and are seen as XML.
  ['xml', 'svg', 'dae', 'x3d', 'fb2'],
  ['cfb', 'doc', 'xls', 'ppt'],
  ['mobi', 'azw3'],
  // Blender saves .blend files compressed (Zstandard, older ones gzip).
  ['zst', 'blend'],
  ['gz', 'blend'],
];

/** Combines the type from the content with the file name's extension. */
export function refineDetectedExt(detectedExt: string, nameExt: string | null): string {
  if (!nameExt || nameExt === detectedExt) return detectedExt;
  const family = CONTAINER_SIBLINGS.find((f) => f.includes(detectedExt));
  return family?.includes(nameExt) ? nameExt : detectedExt;
}

const byExt = new Map<string, FormatInfo>();
for (const f of FORMATS) {
  byExt.set(f.ext, f);
  for (const a of f.aliases ?? []) byExt.set(a, f);
}

/**
 * Normalizes an extension or file name to the canonical extension:
 * '.JPEG' → 'jpg', 'photo.TIF' → 'tiff'. Unknown extensions are returned
 * lowercased without dot.
 */
export function normalizeExt(extOrFileName: string): string {
  const trimmed = extOrFileName.trim().toLowerCase();
  const dot = trimmed.lastIndexOf('.');
  const ext = dot >= 0 ? trimmed.slice(dot + 1) : trimmed;
  return byExt.get(ext)?.ext ?? ext;
}

export function getFormat(ext: string): FormatInfo | undefined {
  return byExt.get(normalizeExt(ext));
}

export function formatsByCategory(category: Category): FormatInfo[] {
  return FORMATS.filter((f) => f.category === category);
}

/** All i18n keys referenced by a format – used by the help-text tests. */
export function formatI18nKeys(f: FormatInfo): string[] {
  return [f.nameKey, f.summaryKey, f.goodForKey, f.badForKey, f.openWithKey].filter(
    (k): k is string => k !== undefined,
  );
}

/**
 * Recommended output formats per input category (shown with ⭐ first).
 * Order matters: the first entry is the strongest recommendation.
 */
export const RECOMMENDED_TARGETS: Partial<Record<Category, readonly string[]>> = {
  image: ['webp', 'jpg', 'png'],
  vector: ['png', 'webp'],
  audio: ['mp3', 'm4a', 'flac', 'wav'],
  video: ['mp4', 'webm', 'gif'],
  midi: ['mp3', 'wav'],
  document: ['docx', 'html', 'md', 'txt'],
  ebook: ['docx', 'html', 'md'],
  '3d': ['glb', 'stl', 'obj'],
  pdf: ['png', 'jpg'],
  data: ['xlsx', 'csv', 'json'],
  archive: ['zip', '7z'],
  font: ['woff2', 'ttf'],
};

/** Formats that need other recommendations than the rest of their category. */
const RECOMMENDED_BY_FORMAT: Record<string, readonly string[]> = {
  // Subtitles are "documents", but become other subtitles (or their words).
  srt: ['vtt', 'ass', 'txt'],
  vtt: ['srt', 'ass', 'txt'],
  ass: ['srt', 'vtt', 'txt'],
};

export function recommendedTargets(inputExt: string): readonly string[] {
  const f = getFormat(inputExt);
  if (!f) return [];
  const recs = RECOMMENDED_BY_FORMAT[f.ext] ?? RECOMMENDED_TARGETS[f.category] ?? [];
  // Never recommend converting a file into its own format.
  return recs.filter((r) => r !== f.ext);
}

export type ConversionWarning =
  'transparencyLost' | 'animationLost' | 'lossy' | 'onlyAudio' | 'formattingLost';

/**
 * Plain-language warnings for a conversion, as ids. The UI renders them
 * through i18n ('warnings.<id>').
 */
export function conversionWarnings(inputExt: string, outputExt: string): ConversionWarning[] {
  const from = getFormat(inputExt);
  const to = getFormat(outputExt);
  if (!from || !to) return [];
  const warnings: ConversionWarning[] = [];
  if (from.supportsTransparency && to.supportsTransparency === false) {
    warnings.push('transparencyLost');
  }
  if (from.supportsAnimation && to.supportsAnimation === false) {
    warnings.push('animationLost');
  }
  if (from.category === 'video' && to.category === 'audio') warnings.push('onlyAudio');
  if (
    to.ext === 'txt' &&
    (from.category === 'document' || from.category === 'ebook') &&
    from.ext !== 'txt'
  ) {
    warnings.push('formattingLost');
  }
  if (to.lossy) warnings.push('lossy');
  return warnings;
}

export const CONVERSION_WARNINGS: readonly ConversionWarning[] = [
  'transparencyLost',
  'animationLost',
  'lossy',
  'onlyAudio',
  'formattingLost',
];
