import { strFromU8, unzipSync } from 'fflate';
import type { MetadataTags } from '../metadata';

/**
 * "Was verrät meine Datei?" – which metadata says something about you:
 * where a photo was taken, which device, who wrote a document, what was
 * changed or commented. Sorted by how much it gives away.
 */

export type PrivacyKind =
  | 'location'
  | 'serial'
  | 'people'
  | 'personTags'
  | 'comments'
  | 'history'
  | 'device'
  | 'software'
  | 'dates'
  | 'thumbnail'
  | 'officeAuthors'
  | 'officeComments'
  | 'officeChanges'
  | 'officeHidden'
  | 'officeNotes'
  | 'officeCompany';

export type PrivacyLevel = 'high' | 'medium' | 'low';

export interface PrivacyFinding {
  kind: PrivacyKind;
  level: PrivacyLevel;
  /** What the file says ("47.37, 8.54", "Canon EOS R6", "Anna Muster"). */
  values: string[];
  /** For counts (comments, changes …). */
  count?: number;
}

export const PRIVACY_KINDS: readonly PrivacyKind[] = [
  'location',
  'serial',
  'people',
  'personTags',
  'comments',
  'history',
  'device',
  'software',
  'dates',
  'thumbnail',
  'officeAuthors',
  'officeComments',
  'officeChanges',
  'officeHidden',
  'officeNotes',
  'officeCompany',
];

const LEVEL: Record<PrivacyKind, PrivacyLevel> = {
  location: 'high',
  serial: 'high',
  personTags: 'high',
  officeChanges: 'high',
  officeHidden: 'high',
  people: 'medium',
  comments: 'medium',
  history: 'medium',
  thumbnail: 'medium',
  officeAuthors: 'medium',
  officeComments: 'medium',
  officeNotes: 'medium',
  officeCompany: 'medium',
  device: 'low',
  software: 'low',
  dates: 'low',
};

const text = (value: unknown): string =>
  Array.isArray(value) ? value.map(String).join(', ') : value === undefined ? '' : String(value);

/** Tag names (after "Group:") per kind. */
const PATTERNS: [Exclude<PrivacyKind, `office${string}` | 'location' | 'thumbnail'>, RegExp][] = [
  ['serial', /SerialNumber$|^ImageUniqueID$|^OwnerName$|^CameraOwnerName$/],
  ['personTags', /^Region(Name|PersonDisplayName)$|^PersonInImage$/],
  ['people', /^(Artist|Author|Creator|XPAuthor|LastModifiedBy|By-line|Writer-Editor|Company)$/],
  ['comments', /^(UserComment|XPComment|Comment|ImageDescription|Caption-Abstract)$/],
  ['history', /^History(Action|SoftwareAgent|When)$|^DocumentAncestors$/],
  ['device', /^(Make|Model|LensModel|LensMake|AndroidModel|HostComputer)$/],
  ['software', /^(Software|CreatorTool|Producer|Creator Tool)$/],
  ['dates', /^(DateTimeOriginal|CreateDate|ModifyDate|CreationDate)$/],
];

/** Values that say nothing (empty, "Unknown", placeholders of cameras). */
const EMPTY = /^(|\s+|unknown|none|0+|default|-+|\(binary data.*\))$/i;

function gpsValue(tags: MetadataTags): string | null {
  const entries = Object.entries(tags);
  const pos = entries.find(([k]) => /:GPSPosition$/.test(k));
  if (pos && text(pos[1]).trim()) return text(pos[1]).trim();
  const lat = entries.find(([k]) => /:GPSLatitude$/.test(k));
  const lon = entries.find(([k]) => /:GPSLongitude$/.test(k));
  if (lat && lon) return `${text(lat[1])}, ${text(lon[1])}`;
  const coords = entries.find(([k]) => /:GPSCoordinates$/.test(k));
  return coords ? text(coords[1]) : null;
}

/** What the metadata (as ExifTool reads it, "Group:Tag") gives away. */
export function privacyFromTags(tags: MetadataTags): PrivacyFinding[] {
  const found = new Map<PrivacyKind, Set<string>>();
  const add = (kind: PrivacyKind, value: string) => {
    const v = value.trim();
    if (EMPTY.test(v)) return;
    const set = found.get(kind) ?? new Set<string>();
    set.add(v.length > 200 ? `${v.slice(0, 200)} …` : v);
    found.set(kind, set);
  };
  const gps = gpsValue(tags);
  if (gps) add('location', gps);
  for (const [key, value] of Object.entries(tags)) {
    const [group, name] = key.includes(':') ? key.split(/:(.*)/s, 2) : ['', key];
    if (!name || group === 'ExifTool' || group === 'System' || group === 'File') continue;
    if (/^(City|Country|State|Sub-location|Location|LocationCreated)$/.test(name)) {
      add('location', text(value));
      continue;
    }
    if (/^(ThumbnailImage|ThumbnailLength|PreviewImage)$/.test(name)) {
      add('thumbnail', name);
      continue;
    }
    for (const [kind, pattern] of PATTERNS) {
      if (pattern.test(name)) {
        add(kind, text(value));
        break;
      }
    }
  }
  return [...found.entries()]
    .map(([kind, values]) => ({ kind, level: LEVEL[kind], values: [...values].slice(0, 20) }))
    .sort((a, b) => PRIVACY_KINDS.indexOf(a.kind) - PRIVACY_KINDS.indexOf(b.kind));
}

const OFFICE = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']);

export function isOfficeFile(ext: string): boolean {
  return OFFICE.has(ext);
}

const all = (xml: string, pattern: RegExp) => [...xml.matchAll(pattern)].map((m) => m[1] ?? '');
const unescape = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * What an Office file (Word, Excel, PowerPoint, OpenDocument) hides inside:
 * authors, comments, tracked changes, hidden text and sheets, speaker notes.
 * The file is a ZIP with XML inside – that's what is read.
 */
export function privacyFromOffice(bytes: Uint8Array): PrivacyFinding[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      // Only the parts that matter (pictures inside are skipped).
      filter: (f) => /\.xml$/i.test(f.name) && f.originalSize < 50 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  const xml = (name: string) => (files[name] ? strFromU8(files[name]) : '');
  const findings: PrivacyFinding[] = [];
  const push = (kind: PrivacyKind, values: string[], count?: number) => {
    const clean = [...new Set(values.map((v) => unescape(v).trim()).filter(Boolean))];
    if (clean.length === 0 && !count) return;
    findings.push({
      kind,
      level: LEVEL[kind],
      values: clean.slice(0, 20),
      ...(count !== undefined && { count }),
    });
  };

  // Who wrote it (OOXML core properties, OpenDocument meta.xml).
  const core = xml('docProps/core.xml') + xml('meta.xml');
  push('officeAuthors', [
    ...all(core, /<dc:creator[^>]*>([^<]*)</g),
    ...all(core, /<cp:lastModifiedBy[^>]*>([^<]*)</g),
    ...all(core, /<meta:initial-creator[^>]*>([^<]*)</g),
  ]);
  const app = xml('docProps/app.xml');
  push('officeCompany', [...all(app, /<Company>([^<]*)</g), ...all(app, /<Manager>([^<]*)</g)]);

  const names = Object.keys(files);
  // Comments: Word, Excel (comments1.xml …, threaded comments), PowerPoint.
  const commentFiles = names.filter((n) =>
    /^(word\/comments\.xml|xl\/comments\d*\.xml|xl\/threadedComments\/.*|ppt\/comments\/.*)$/.test(
      n,
    ),
  );
  let comments = 0;
  const commentAuthors: string[] = [];
  for (const name of commentFiles) {
    const c = xml(name);
    comments += (c.match(/<(w:comment|comment|threadedComment|p:cm)\b/g) ?? []).length;
    commentAuthors.push(...all(c, /w:author="([^"]*)"/g));
  }
  // OpenDocument comments live in content.xml.
  const content = xml('content.xml');
  comments += (content.match(/<office:annotation\b/g) ?? []).length;
  commentAuthors.push(...all(content, /<office:annotation\b[\s\S]*?<dc:creator>([^<]*)</g));
  if (comments > 0) push('officeComments', commentAuthors, comments);

  // Tracked changes (Word): what was added and removed, and by whom.
  const doc = xml('word/document.xml');
  const changes = (doc.match(/<w:(ins|del)\b/g) ?? []).length;
  if (changes > 0)
    push('officeChanges', all(doc, /<w:(?:ins|del)\b[^>]*w:author="([^"]*)"/g), changes);
  const odfChanges = (content.match(/<text:changed-region\b/g) ?? []).length;
  if (odfChanges > 0) push('officeChanges', [], odfChanges);

  // Hidden things: hidden text in Word, hidden sheets in Excel.
  const hiddenText = (doc.match(/<w:vanish\s*\/>/g) ?? []).length;
  const hiddenSheets = all(
    xml('xl/workbook.xml'),
    /<sheet\b[^>]*name="([^"]*)"[^>]*state="(?:very)?[Hh]idden"/g,
  );
  if (hiddenText > 0 || hiddenSheets.length > 0) {
    push('officeHidden', hiddenSheets, hiddenText + hiddenSheets.length);
  }

  // Speaker notes in presentations.
  const notes = names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
  // Only notes with words (the slide number alone is in every notes page).
  const withText = notes.filter((n) => /<a:t>[^<]*\p{L}[^<]*<\/a:t>/u.test(xml(n))).length;
  if (withText > 0) push('officeNotes', [], withText);

  return findings;
}

/**
 * GPS position as ExifTool writes it ("47 deg 22' 36.84\" N, 8 deg 32' 30.12\" E")
 * or as plain numbers ("47.3769, 8.5417") → decimal degrees for a map link.
 */
export function parseGps(value: string): { lat: number; lon: number } | null {
  const dms = [
    ...value.matchAll(/(\d+(?:\.\d+)?)\s*deg\s*(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)"\s*([NSEW])/gi),
  ];
  const toDecimal = (m: RegExpMatchArray) => {
    const v = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
    return /[SW]/i.test(m[4] ?? '') ? -v : v;
  };
  if (dms.length >= 2 && dms[0] && dms[1]) {
    return { lat: toDecimal(dms[0]), lon: toDecimal(dms[1]) };
  }
  const plain = /(-?\d+(?:\.\d+)?)\s*([NS])?\s*,\s*(-?\d+(?:\.\d+)?)\s*([EW])?/i.exec(value);
  if (!plain) return null;
  const lat = Number(plain[1]) * (/s/i.test(plain[2] ?? '') ? -1 : 1);
  const lon = Number(plain[3]) * (/w/i.test(plain[4] ?? '') ? -1 : 1);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
