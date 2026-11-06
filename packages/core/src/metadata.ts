/**
 * Metadata (title, author, copyright, location …) of a file: read and edit.
 * The same field list for every format; how a field is stored differs per
 * format and is decided here, not in the UI.
 */

export const METADATA_FIELDS = [
  'title',
  'description',
  'author',
  'copyright',
  'keywords',
  'date',
] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];

export interface MetadataEdits {
  /** New values; a missing field keeps what the file has, '' removes it. */
  values: Partial<Record<MetadataField, string>>;
  /** Remove the place where a photo or video was taken. */
  removeGps: boolean;
  /** Remove all metadata first (before writing the new values). */
  removeAll: boolean;
}

export const NO_METADATA_EDITS: MetadataEdits = { values: {}, removeGps: false, removeAll: false };

export function hasMetadataEdits(edits: MetadataEdits | undefined): edits is MetadataEdits {
  return Boolean(
    edits && (edits.removeAll || edits.removeGps || Object.keys(edits.values).length > 0),
  );
}

/** Formats whose metadata ExifTool writes (in the browser it can't write music files or PDFs). */
const EXIFTOOL_WRITABLE = new Set([
  'jpg',
  'png',
  'webp',
  'tiff',
  'heic',
  'avif',
  'jxl',
  'gif',
  'mp4',
  'mov',
  'm4a',
]);
/** Music files: ffmpeg rewrites the tags and copies the sound as it is. */
const FFMPEG_AUDIO = new Set(['mp3', 'flac', 'ogg', 'opus', 'wav']);

/** Who writes metadata for this format, or null when Conbert can only read it. */
export type MetadataWriter = 'exiftool' | 'ffmpeg' | 'pdf';

export function metadataWriter(ext: string): MetadataWriter | null {
  if (EXIFTOOL_WRITABLE.has(ext)) return 'exiftool';
  if (FFMPEG_AUDIO.has(ext)) return 'ffmpeg';
  if (ext === 'pdf') return 'pdf';
  return null;
}

export function metadataWritable(ext: string): boolean {
  return metadataWriter(ext) !== null;
}

/** Music tags have no keywords. */
export function metadataFieldWritable(ext: string, field: MetadataField): boolean {
  const writer = metadataWriter(ext);
  if (!writer) return false;
  return !(writer === 'ffmpeg' && field === 'keywords');
}

/**
 * ffmpeg arguments that rewrite the tags of a music file without touching
 * the sound ("-c copy"). '' removes a tag.
 */
export function ffmpegMetadataArgs(
  input: string,
  output: string,
  ext: string,
  edits: MetadataEdits,
): string[] {
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', input];
  // Every stream (also a cover picture), unchanged.
  args.push('-map', '0', '-c', 'copy', '-map_metadata', edits.removeAll ? '-1' : '0');
  const keys: Partial<Record<MetadataField, string[]>> = {
    title: ['title'],
    author: ['artist'],
    copyright: ['copyright'],
    // ID3 and RIFF know "comment"; Vorbis comments also have DESCRIPTION.
    description:
      ext === 'flac' || ext === 'ogg' || ext === 'opus' ? ['comment', 'description'] : ['comment'],
    date: ['date'],
  };
  for (const field of METADATA_FIELDS) {
    const raw = edits.values[field];
    const names = keys[field];
    if (raw === undefined || !names) continue;
    let value = raw.trim();
    // Music players expect a plain date (or year), not a time of day.
    if (field === 'date' && value) value = value.slice(0, 10);
    for (const name of names) args.push('-metadata', `${name}=${value}`);
  }
  if (ext === 'mp3') args.push('-id3v2_version', '3');
  args.push(output);
  return args;
}

/** PDF document properties ("Info"): key → new value, null = remove. */
export interface PdfInfoEdits {
  /** Remove all document properties and the XMP packet first. */
  clear: boolean;
  entries: Record<string, string | null>;
  /** New creation date, null = remove, undefined = keep. */
  created?: Date | null;
}

export function pdfInfoEdits(edits: MetadataEdits): PdfInfoEdits {
  const names: Record<Exclude<MetadataField, 'date'>, string> = {
    title: 'Title',
    author: 'Author',
    description: 'Subject',
    keywords: 'Keywords',
    // Not a standard field, but shown by most PDF programs as a custom property.
    copyright: 'Copyright',
  };
  const result: PdfInfoEdits = { clear: edits.removeAll, entries: {} };
  for (const field of METADATA_FIELDS) {
    const raw = edits.values[field];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (field === 'date') {
      if (!value) result.created = null;
      else {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) result.created = date;
      }
      continue;
    }
    result.entries[names[field]] = value || null;
  }
  return result;
}

/** QuickTime-based files (video, M4A) keep their tags in the "ItemList" (like iTunes). */
const QUICKTIME = new Set(['mp4', 'mov', 'm4a']);
/** Images that also carry classic EXIF tags (many programs only read those). */
const EXIF_IMAGES = new Set(['jpg', 'tiff', 'heic', 'avif', 'webp', 'jxl', 'png']);

/** "2026-10-27T14:30" (date picker) → "2026:10:27 14:30:00" (ExifTool). */
export function toExifDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
  if (!m) return null;
  return `${m[1]}:${m[2]}:${m[3]} ${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
}

/** "2026:10:27 14:30:00" (ExifTool) → "2026-10-27T14:30" (date picker). */
export function fromExifDate(value: string): string | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(value.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` : null;
}

const splitKeywords = (value: string) =>
  value
    .split(/[,;]/)
    .map((k) => k.trim())
    .filter(Boolean);

export interface ExifToolWrite {
  /** Tag → value; '' deletes the tag. */
  tags: Record<string, string | string[]>;
  /** Extra arguments (deleting groups, ignoring minor warnings). */
  args: string[];
}

/** What ExifTool has to do for these edits on a file of this format. */
export function exiftoolWrite(ext: string, edits: MetadataEdits): ExifToolWrite {
  // -m: minor warnings (odd but harmless structures) must not stop the write.
  const args = ['-m'];
  if (edits.removeAll) args.push('-all=');
  // GPS can sit in EXIF, XMP and QuickTime – remove every tag whose name starts with GPS.
  if (edits.removeGps && !edits.removeAll) args.push('-gps:all=', '-GPS*=');
  const tags: Record<string, string | string[]> = {};
  const set = (names: string[], value: string | string[]) => {
    for (const name of names) tags[name] = value;
  };
  const exif = EXIF_IMAGES.has(ext);
  const quicktime = QUICKTIME.has(ext);
  for (const field of METADATA_FIELDS) {
    const raw = edits.values[field];
    if (raw === undefined) continue;
    const value = raw.trim();
    switch (field) {
      case 'title':
        set(['XMP-dc:Title', ...(quicktime ? ['ItemList:Title'] : [])], value);
        break;
      case 'description':
        set(
          [
            'XMP-dc:Description',
            ...(exif ? ['IFD0:ImageDescription'] : []),
            ...(quicktime ? ['ItemList:Description', 'ItemList:Comment'] : []),
          ],
          value,
        );
        break;
      case 'author':
        set(
          [
            'XMP-dc:Creator',
            ...(exif ? ['IFD0:Artist'] : []),
            ...(quicktime ? ['ItemList:Artist'] : []),
          ],
          value,
        );
        break;
      case 'copyright':
        set(
          [
            'XMP-dc:Rights',
            ...(exif ? ['IFD0:Copyright'] : []),
            ...(quicktime ? ['ItemList:Copyright'] : []),
          ],
          value,
        );
        break;
      case 'keywords':
        set(['XMP-dc:Subject'], value ? splitKeywords(value) : '');
        break;
      case 'date': {
        const date = value ? toExifDate(value) : '';
        if (date === null) break;
        set(
          [
            'XMP-exif:DateTimeOriginal',
            ...(exif ? ['ExifIFD:DateTimeOriginal'] : []),
            ...(quicktime ? ['QuickTime:CreateDate'] : []),
          ],
          date,
        );
        break;
      }
    }
  }
  return { tags, args };
}

/** All tags of a file as ExifTool reports them with -json -G1 ("Group:Tag" → value). */
export type MetadataTags = Record<string, unknown>;

/** Where each field is usually found when reading, best first. */
const READ_TAGS: Record<MetadataField, RegExp[]> = {
  title: [
    /^XMP-dc:Title$/,
    /^(ItemList|UserData|Keys|QuickTime):Title$/,
    /^PDF:Title$/,
    /:Title$/,
    /:XPTitle$/,
  ],
  description: [
    /^XMP-dc:Description$/,
    /:ImageDescription$/,
    /^(ItemList|Keys|UserData):(Description|Comment)$/,
    /^PDF:Subject$/,
    /:Comment$/,
  ],
  author: [/^XMP-dc:Creator$/, /:Artist$/, /^PDF:Author$/, /:Author$/, /:XPAuthor$/],
  copyright: [/^XMP-dc:Rights$/, /:Copyright$/],
  keywords: [/^XMP-dc:Subject$/, /:Keywords$/, /:XPKeywords$/],
  date: [/:DateTimeOriginal$/, /^QuickTime:CreateDate$/, /:CreateDate$/, /:CreationDate$/],
};

const text = (value: unknown): string =>
  Array.isArray(value) ? value.map(String).join(', ') : value === undefined ? '' : String(value);

/** The common fields as the file has them now (to fill the form). */
export function commonFields(tags: MetadataTags): Partial<Record<MetadataField, string>> {
  const result: Partial<Record<MetadataField, string>> = {};
  const keys = Object.keys(tags);
  for (const field of METADATA_FIELDS) {
    for (const pattern of READ_TAGS[field]) {
      const key = keys.find((k) => pattern.test(k) && text(tags[k]).trim() !== '');
      if (!key) continue;
      const value = text(tags[key]).trim();
      result[field] = field === 'date' ? (fromExifDate(value) ?? value) : value;
      break;
    }
  }
  return result;
}

/** Does the file say where it was made? (Photos from phones usually do.) */
export function hasLocation(tags: MetadataTags): boolean {
  return Object.keys(tags).some((k) => /:GPS(Latitude|Longitude|Position|Coordinates)$/.test(k));
}

/** Groups that only describe ExifTool itself or the temporary file name. */
const HIDDEN_GROUPS = new Set(['ExifTool', 'System', 'SourceFile']);

export interface MetadataGroup {
  group: string;
  entries: [string, string][];
}

/** Tags grouped for display ("IFD0", "GPS", "XMP-dc" …), without ExifTool's own notes. */
export function groupMetadata(tags: MetadataTags): MetadataGroup[] {
  const groups = new Map<string, [string, string][]>();
  for (const [key, value] of Object.entries(tags)) {
    const [group, name] = key.includes(':') ? key.split(/:(.*)/s, 2) : ['SourceFile', key];
    if (!group || !name || HIDDEN_GROUPS.has(group)) continue;
    const list = groups.get(group) ?? [];
    list.push([name, text(value)]);
    groups.set(group, list);
  }
  return [...groups.entries()].map(([group, entries]) => ({ group, entries }));
}

/**
 * Tags and groups that get a plain-language name in "Show all metadata"
 * (texts: metadata.tagNames.* / metadata.groupNames.*). Others keep the
 * name ExifTool uses.
 */
export const METADATA_TAG_NAMES = [
  'Make',
  'Model',
  'LensModel',
  'SerialNumber',
  'OwnerName',
  'Software',
  'HostComputer',
  'DateTimeOriginal',
  'CreateDate',
  'ModifyDate',
  'ExposureTime',
  'FNumber',
  'ISO',
  'FocalLength',
  'Flash',
  'Orientation',
  'ImageWidth',
  'ImageHeight',
  'XResolution',
  'YResolution',
  'ColorSpace',
  'Artist',
  'Copyright',
  'ImageDescription',
  'Title',
  'Description',
  'Creator',
  'Rights',
  'Subject',
  'Keywords',
  'Author',
  'Producer',
  'Comment',
  'GPSLatitude',
  'GPSLongitude',
  'GPSAltitude',
  'GPSPosition',
  'GPSDateStamp',
  'Duration',
  'SampleRate',
  'AudioBitrate',
  'Album',
  'Genre',
  'Track',
  'Year',
  'Encoder',
  'PageCount',
  'PDFVersion',
  'Rating',
  'FileType',
  'FileTypeExtension',
  'MIMEType',
  'Encoding',
  'NumChannels',
  'BitsPerSample',
  'ImageSize',
  'Megapixels',
] as const;

export const METADATA_GROUP_NAMES = [
  'File',
  'IFD0',
  'IFD1',
  'ExifIFD',
  'GPS',
  'XMP-dc',
  'XMP-xmp',
  'IPTC',
  'ICC_Profile',
  'Composite',
  'MakerNotes',
  'QuickTime',
  'ItemList',
  'PDF',
  'ID3v2_3',
  'ID3v2_4',
  'ID3v1',
  'Vorbis',
  'RIFF',
  'JFIF',
  'MPEG',
  'PNG',
] as const;

const KNOWN_TAGS = new Set<string>(METADATA_TAG_NAMES);
const KNOWN_GROUPS = new Set<string>(METADATA_GROUP_NAMES);

/** Text keys for a tag or group name, or null when there is no translation. */
export function metadataTagKey(name: string): string | null {
  return KNOWN_TAGS.has(name) ? `metadata.tagNames.${name}` : null;
}
export function metadataGroupKey(group: string): string | null {
  return KNOWN_GROUPS.has(group) ? `metadata.groupNames.${group}` : null;
}
