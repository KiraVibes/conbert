import { ConversionError } from '../errors';
import { normalizeExt } from '../formats';
import { SUBTITLE_READ, SUBTITLE_WRITE, resolveSubtitleOptions } from '../options/subtitles';

/**
 * Subtitles: SRT, WebVTT and ASS/SSA in, SRT, WebVTT, ASS or plain text out.
 * Times and text (with italic, bold, underline) are kept; colours, positions
 * and effects of ASS don't exist in SRT/VTT and are dropped.
 */

export interface Cue {
  /** Milliseconds from the start of the video. */
  start: number;
  end: number;
  /** Text with line breaks; markup only as <i>, <b>, <u>. */
  text: string;
}

// --- Reading ---------------------------------------------------------------

/** Text files come as UTF-8, UTF-16 or (older SRTs) Windows-1252. */
export function decodeSubtitleText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** "01:02:03,456", "02:03.456" or "1:02:03.45" → milliseconds. */
function parseTime(raw: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(raw.trim());
  if (!m) return null;
  const fraction = (m[4] ?? '0').padEnd(3, '0');
  return (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(fraction);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lrm: '‎',
  rlm: '‏',
};

/** Keeps <i>, <b>, <u>; drops every other tag (font, c, v, ruby, timestamps …). */
function cleanMarkup(text: string): string {
  return (
    text
      .replace(/\{\\[^}]*\}/g, '') // ASS-style codes some SRTs carry, e.g. {\an8}
      .replace(
        /<(\/?)([ibu])(?:\.[^>\s]*)?\s*>/gi,
        (_m, close: string, tag: string) => `<${close}${tag.toLowerCase()}>`,
      )
      // Only real tags (<font …>, </c>, <00:01.000>) – a lone "<" in the text stays.
      .replace(/<(?!\/?[ibu]>)(?:\/?[a-z][^<>]*|\d[^<>]*)>/gi, '')
  );
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const TIMING = /^\s*(\S+)\s+-->\s+(\S+)/;

/** SRT and WebVTT share the block layout: optional id, timing line, text. */
function parseBlocks(text: string, vtt: boolean): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
  for (const block of blocks) {
    const lines = block.split('\n');
    // WebVTT: header, notes, styles and regions are no cues.
    if (vtt && /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0]?.trim() ?? '')) continue;
    const at = lines.findIndex((line) => TIMING.test(line));
    if (at < 0 || at > 1) continue;
    const m = TIMING.exec(lines[at] ?? '');
    const start = m ? parseTime(m[1] ?? '') : null;
    const end = m ? parseTime(m[2] ?? '') : null;
    if (start === null || end === null) continue;
    const body = lines
      .slice(at + 1)
      .join('\n')
      .trim();
    const clean = cleanMarkup(body);
    const decoded = vtt ? decodeEntities(clean) : clean;
    if (decoded.trim()) cues.push({ start, end, text: decoded.trim() });
  }
  return cues;
}

/** ASS override codes → <i>/<b>/<u>; positions, colours, effects are dropped. */
function assText(raw: string): string | null {
  const open = { i: false, b: false, u: false };
  let out = '';
  let drawing = false;
  for (const part of raw.split(/(\{[^}]*\})/)) {
    if (part.startsWith('{') && part.endsWith('}')) {
      for (const m of part.matchAll(/\\(i|b|u|p)(\d+)/g)) {
        const tag = m[1] as 'i' | 'b' | 'u' | 'p';
        const on = Number(m[2]) > 0;
        if (tag === 'p') {
          drawing = on;
          continue;
        }
        if (on !== open[tag]) {
          out += on ? `<${tag}>` : `</${tag}>`;
          open[tag] = on;
        }
      }
      continue;
    }
    if (!drawing) out += part;
  }
  for (const tag of ['u', 'b', 'i'] as const) if (open[tag]) out += `</${tag}>`;
  const text = out
    .replace(/\\N|\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/<([ibu])><\/\1>/g, '')
    .trim();
  return text || null;
}

function parseAss(text: string): Cue[] {
  const cues: Cue[] = [];
  let inEvents = false;
  let fields: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const section = /^\s*\[(.+)\]\s*$/.exec(line);
    if (section) {
      inEvents = section[1]?.toLowerCase() === 'events';
      continue;
    }
    if (!inEvents) continue;
    const format = /^Format:\s*(.*)$/i.exec(line);
    if (format) {
      fields = (format[1] ?? '').split(',').map((f) => f.trim().toLowerCase());
      continue;
    }
    const dialogue = /^Dialogue:\s*(.*)$/i.exec(line);
    if (!dialogue) continue;
    const names =
      fields.length > 0
        ? fields
        : [
            'layer',
            'start',
            'end',
            'style',
            'name',
            'marginl',
            'marginr',
            'marginv',
            'effect',
            'text',
          ];
    // The text is the last field and may contain commas itself.
    const values = (dialogue[1] ?? '').split(',');
    const textIndex = names.indexOf('text');
    const get = (name: string) => values[names.indexOf(name)]?.trim() ?? '';
    const start = parseTime(get('start'));
    const end = parseTime(get('end'));
    const body = assText(values.slice(textIndex < 0 ? names.length - 1 : textIndex).join(','));
    if (start === null || end === null || body === null) continue;
    cues.push({ start, end, text: body });
  }
  return cues;
}

/** The format by its content: ASS has sections, WebVTT a header, LRC [mm:ss] stamps, the rest is SRT. */
export function subtitleFormatOf(text: string): 'srt' | 'vtt' | 'ass' | 'lrc' {
  const start = text.replace(/^\uFEFF/, '').trimStart();
  if (/^WEBVTT/.test(start)) return 'vtt';
  if (/^\[(Script Info|V4\+? Styles|Events)\]/im.test(start)) return 'ass';
  if (/^\[(\d{1,3}:\d{1,2}([.:]\d{1,3})?|[a-z]{2,6}:[^\]]*)\]/i.test(start)) return 'lrc';
  return 'srt';
}

const LRC_STAMP = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
/** A line stays on screen at most this long when the next one is far away (instrumental parts). */
const LRC_MAX_LINE_MS = 10_000;
const LRC_LAST_LINE_MS = 6_000;

/**
 * Song lyrics in LRC: "[01:23.45]A line" (several stamps per line allowed,
 * word stamps <01:23.45> of "enhanced LRC" are dropped). A line lasts until
 * the next one starts; empty lines end the previous one (instrumental part).
 * Tags like [ar:Artist] are skipped, [offset:+500] shows everything earlier.
 */
export function parseLrc(text: string): Cue[] {
  let offset = 0;
  const stamps: { time: number; text: string }[] = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    let rest = raw.trim();
    const off = /^\[offset:\s*([+-]?\d+)\s*\]$/i.exec(rest);
    if (off) {
      offset = Number(off[1]);
      continue;
    }
    const times: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = LRC_STAMP.exec(rest))) {
      const frac = m[3] ?? '0';
      const ms = Number(frac) * 10 ** (3 - frac.length);
      times.push((Number(m[1]) * 60 + Number(m[2])) * 1000 + ms);
      rest = rest.slice(m[0].length);
    }
    if (times.length === 0) continue;
    const words = rest
      .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    for (const time of times) stamps.push({ time: Math.max(0, time - offset), text: words });
  }
  stamps.sort((a, b) => a.time - b.time);
  const cues: Cue[] = [];
  stamps.forEach((s, i) => {
    if (!s.text) return;
    const next = stamps[i + 1];
    const end = next ? Math.min(next.time, s.time + LRC_MAX_LINE_MS) : s.time + LRC_LAST_LINE_MS;
    if (end > s.time) cues.push({ start: s.time, end, text: s.text });
  });
  return cues;
}

export function parseSubtitles(text: string, ext: string): Cue[] {
  const cues =
    ext === 'ass' || ext === 'ssa'
      ? parseAss(text)
      : ext === 'lrc'
        ? parseLrc(text)
        : parseBlocks(text, ext === 'vtt' || /^\uFEFF?WEBVTT/.test(text));
  return cues.filter((c) => c.end > c.start).sort((a, b) => a.start - b.start || a.end - b.end);
}

// --- Writing ---------------------------------------------------------------

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function clock(ms: number): { h: number; m: number; s: number; ms: number } {
  const total = Math.max(0, Math.round(ms));
  return {
    h: Math.floor(total / 3_600_000),
    m: Math.floor(total / 60_000) % 60,
    s: Math.floor(total / 1000) % 60,
    ms: total % 1000,
  };
}

const srtTime = (ms: number) => {
  const t = clock(ms);
  return `${pad(t.h)}:${pad(t.m)}:${pad(t.s)},${pad(t.ms, 3)}`;
};
const vttTime = (ms: number) => srtTime(ms).replace(',', '.');
const assTime = (ms: number) => {
  // Centiseconds: round first, so 999 ms doesn't turn into ".100".
  const t = clock(Math.round(ms / 10) * 10);
  return `${t.h}:${pad(t.m)}:${pad(t.s)}.${pad(Math.floor(t.ms / 10))}`;
};

/** Splits text into markup tags and plain parts. */
function tokens(text: string): { tag?: string; text: string }[] {
  return text
    .split(/(<\/?[ibu]>)/)
    .filter(Boolean)
    .map((part) => (/^<\/?[ibu]>$/.test(part) ? { tag: part, text: '' } : { text: part }));
}

const plain = (text: string) => text.replace(/<\/?[ibu]>/g, '');

function writeSrt(cues: Cue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join('\n');
}

function writeVtt(cues: Cue[]): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = cues.map((c) => {
    const text = tokens(c.text)
      .map((t) => t.tag ?? escape(t.text))
      .join('')
      // A blank line would end the cue early.
      .replace(/\n{2,}/g, '\n');
    return `${vttTime(c.start)} --> ${vttTime(c.end)}\n${text}\n`;
  });
  return `WEBVTT\n\n${body.join('\n')}`;
}

const ASS_HEADER = `[Script Info]
; Made with Conbert
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,80,80,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

function writeAss(cues: Cue[]): string {
  const code: Record<string, string> = {
    '<i>': '{\\i1}',
    '</i>': '{\\i0}',
    '<b>': '{\\b1}',
    '</b>': '{\\b0}',
    '<u>': '{\\u1}',
    '</u>': '{\\u0}',
  };
  const lines = cues.map((c) => {
    const text = tokens(c.text)
      .map((t) =>
        t.tag ? (code[t.tag] ?? '') : t.text.replace(/[{}]/g, (b) => (b === '{' ? '(' : ')')),
      )
      .join('')
      .replace(/\n/g, '\\N');
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${text}`;
  });
  return `${ASS_HEADER}${lines.join('\n')}\n`;
}

/** Only the words, one subtitle per line (for reading or quoting). */
function writeTxt(cues: Cue[]): string {
  const lines: string[] = [];
  for (const c of cues) {
    const text = plain(c.text)
      .replace(/\s*\n\s*/g, ' ')
      .trim();
    // Some subtitles repeat a line while a speaker keeps talking.
    if (text && text !== lines[lines.length - 1]) lines.push(text);
  }
  return `${lines.join('\n')}\n`;
}

/** Moves every subtitle by `shiftMs` (earlier/later); what ends before 0 is dropped. */
export function shiftCues(cues: Cue[], shiftMs: number): Cue[] {
  if (!shiftMs) return cues;
  return cues
    .map((c) => ({ ...c, start: Math.max(0, c.start + shiftMs), end: c.end + shiftMs }))
    .filter((c) => c.end > c.start);
}

export function writeSubtitles(cues: Cue[], ext: string): string {
  switch (ext) {
    case 'srt':
      return writeSrt(cues);
    case 'vtt':
      return writeVtt(cues);
    case 'ass':
      return writeAss(cues);
    case 'txt':
      return writeTxt(cues);
    default:
      throw new ConversionError('errors.formatUnavailable', `subtitles: can't write .${ext}`);
  }
}

/** One subtitle file to another format (same code in the browser and on the server). */
export function convertSubtitles(
  input: Uint8Array,
  from: string,
  to: string,
  options: Record<string, unknown>,
): Uint8Array {
  from = normalizeExt(from);
  to = normalizeExt(to);
  if (!SUBTITLE_READ.includes(from)) {
    throw new ConversionError('errors.formatUnavailable', `subtitles: can't read .${from}`);
  }
  if (!SUBTITLE_WRITE.includes(to)) {
    throw new ConversionError('errors.formatUnavailable', `subtitles: can't write .${to}`);
  }
  const cues = parseSubtitles(decodeSubtitleText(input), from);
  if (cues.length === 0) throw new ConversionError('errors.subtitlesEmpty');
  const { shiftMs } = resolveSubtitleOptions(options);
  const moved = shiftCues(cues, shiftMs);
  if (moved.length === 0)
    throw new ConversionError('errors.subtitlesEmpty', 'all cues shifted before 0');
  return new TextEncoder().encode(writeSubtitles(moved, to));
}
