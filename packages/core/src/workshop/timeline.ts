/**
 * Timeline: every date and time a file carries (EXIF, XMP edit history,
 * PDF, Office, video, the file system), in order – with hints where the
 * dates don't fit together.
 */

export interface TimelineEvent {
  /** ISO time; without a time zone when the file doesn't say which. */
  when: string;
  /** Milliseconds for sorting (local reading when no zone is given). */
  ms: number;
  /** Where it comes from, e.g. "ExifIFD:DateTimeOriginal". */
  source: string;
  /** Short key for the label (taken, created, modified …). */
  label: TimelineLabel;
  /** The time zone was given. */
  zoned: boolean;
}

export const TIMELINE_LABELS = [
  'taken',
  'created',
  'modified',
  'metadata',
  'history',
  'gps',
  'printed',
  'file',
  'other',
] as const;
export type TimelineLabel = (typeof TIMELINE_LABELS)[number];

export const TIMELINE_WARNINGS = [
  'modifiedBeforeCreated',
  'future',
  'clockNotSet',
  'editedWith',
  'fileOlder',
  'editedLater',
  'zones',
] as const;
export type TimelineWarningKey = (typeof TIMELINE_WARNINGS)[number];

export interface TimelineWarning {
  key: TimelineWarningKey;
  values?: Record<string, string>;
}

const DATE =
  /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?/;

/** "2021:06:01 12:30:00+02:00" (ExifTool style) → time; null for zero or broken dates. */
export function parseTagDate(value: string): { ms: number; iso: string; zoned: boolean } | null {
  const m = DATE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', zone] = m;
  if (Number(y) < 1900 || Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1) return null;
  const base = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  const z = zone
    ? zone === 'Z'
      ? 'Z'
      : zone.includes(':')
        ? zone
        : `${zone.slice(0, 3)}:${zone.slice(3)}`
    : '';
  const ms = Date.parse(base + z);
  if (Number.isNaN(ms)) return null;
  return { ms, iso: base + z, zoned: Boolean(zone) };
}

function labelOf(tag: string): TimelineLabel {
  const t = tag.toLowerCase();
  if (
    /datetimeoriginal|datetimedigitized|^.*:creationdate$|contentcreatedate|datecreated$/.test(t) &&
    !t.includes('file')
  )
    return 'taken';
  if (t.includes('history')) return 'history';
  if (t.includes('gps')) return 'gps';
  if (t.includes('metadatadate')) return 'metadata';
  if (t.includes('print')) return 'printed';
  if (/modif|changed|lastsaved/.test(t)) return 'modified';
  if (/creat/.test(t)) return 'created';
  return 'other';
}

/** Groups that describe the copy being looked at, not the file's own history. */
const SKIP_GROUP = /^(System|File|ExifTool|Composite):/;
const EDITORS =
  /photoshop|lightroom|gimp|affinity|pixelmator|snapseed|picsart|canva|paint\.net|facetune|meitu|luminar|capture one|darktable|faceapp/i;

/**
 * Builds the timeline from ExifTool tags ("Group:Tag" → value) and the
 * file's own "last changed" time from the file system.
 */
export function buildTimeline(
  tags: Record<string, unknown>,
  fileModified: number | null,
  now = Date.now(),
): { events: TimelineEvent[]; warnings: TimelineWarning[] } {
  const events: TimelineEvent[] = [];
  for (const [source, raw] of Object.entries(tags)) {
    if (SKIP_GROUP.test(source)) continue;
    if (!/date|time|when/i.test(source.split(':').pop() ?? '')) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (typeof v !== 'string') continue;
      const d = parseTagDate(v);
      if (d) events.push({ when: d.iso, ms: d.ms, source, label: labelOf(source), zoned: d.zoned });
    }
  }
  if (fileModified !== null) {
    events.push({
      when: new Date(fileModified).toISOString(),
      ms: fileModified,
      source: 'file',
      label: 'file',
      zoned: true,
    });
  }
  events.sort((a, b) => a.ms - b.ms);

  const warnings: TimelineWarning[] = [];
  const content = events.filter((e) => e.label !== 'file');
  const first = (label: TimelineLabel) => content.find((e) => e.label === label);
  const created = first('taken') ?? first('created');
  const modified = content.filter((e) => e.label === 'modified').at(-1);
  // Times without a zone may be up to 14 h off – only clear cases count.
  const DAY = 86_400_000;
  if (created && modified && modified.ms < created.ms - DAY)
    warnings.push({ key: 'modifiedBeforeCreated' });
  if (events.some((e) => e.ms > now + DAY)) warnings.push({ key: 'future' });
  if (
    content.some(
      (e) => e.ms < Date.UTC(1995, 0, 1) || /^(2000-01-01|1970-01-01|2001-01-01)T00:0/.test(e.when),
    )
  )
    warnings.push({ key: 'clockNotSet' });
  const software = Object.entries(tags).find(
    ([k, v]) => /:(Software|CreatorTool|HistorySoftwareAgent)$/.test(k) && EDITORS.test(String(v)),
  );
  if (software)
    warnings.push({
      key: 'editedWith',
      values: { software: String(Array.isArray(software[1]) ? software[1][0] : software[1]) },
    });
  const earliest = content[0];
  if (fileModified !== null && earliest && fileModified < earliest.ms - DAY)
    warnings.push({ key: 'fileOlder' });
  const taken = first('taken');
  if (taken && modified && modified.ms - taken.ms > DAY) warnings.push({ key: 'editedLater' });
  const zones = new Set(
    content.filter((e) => e.zoned && !e.when.endsWith('Z')).map((e) => e.when.slice(19)),
  );
  if (zones.size > 1) warnings.push({ key: 'zones', values: { zones: [...zones].join(', ') } });
  return { events, warnings };
}
