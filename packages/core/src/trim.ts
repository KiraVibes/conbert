/**
 * Cutting a video or song to a part ("Schneiden"). The part travels as plain
 * options, so it reaches the server, the history and workflows like any other
 * setting: `trimStart` / `trimEnd` in seconds, `trimFast` for cutting without
 * re-encoding (only when the format stays the same).
 */
export const TRIM_KEYS = ['trimStart', 'trimEnd', 'trimFast'] as const;

export interface Trim {
  /** Seconds from the beginning; 0 = from the start. */
  start: number;
  /** Seconds from the beginning, or null for "to the end". */
  end: number | null;
  /** Cut at the nearest key frame without re-encoding (same format only). */
  fast: boolean;
}

const seconds = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

/** The part to keep, or null when nothing is cut away. */
export function readTrim(options: Record<string, unknown>): Trim | null {
  const start = seconds(options['trimStart']) ?? 0;
  const rawEnd = seconds(options['trimEnd']);
  const end = rawEnd !== null && rawEnd > start ? rawEnd : null;
  if (start === 0 && end === null) return null;
  return { start, end, fast: options['trimFast'] === true };
}

/** Option values for a part; an empty part removes all trim options. */
export function trimOptions(trim: Trim | null): Record<string, unknown> {
  if (!trim || (trim.start <= 0 && trim.end === null)) {
    return { trimStart: undefined, trimEnd: undefined, trimFast: undefined };
  }
  return {
    trimStart: round(Math.max(0, trim.start)),
    trimEnd: trim.end === null ? undefined : round(trim.end),
    trimFast: trim.fast || undefined,
  };
}

/** Keeps options without the trim keys (e.g. for a new target). */
export function pickTrimOptions(options: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of TRIM_KEYS) if (options[key] !== undefined) picked[key] = options[key];
  return picked;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** 75.5 → "1:15.5", 3725 → "1:02:05" (tenths of a second). */
export function formatTimecode(totalSeconds: number): string {
  const tenthsTotal = Math.round(Math.max(0, totalSeconds) * 10);
  const tenths = tenthsTotal % 10;
  const whole = Math.floor(tenthsTotal / 10);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const sec = `${String(whole % 60).padStart(2, '0')}${tenths > 0 ? `.${tenths}` : ''}`;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${sec}` : `${minutes}:${sec}`;
}

/** "1:15.5", "75,5", "1:02:05" → seconds; null when it isn't a time. */
export function parseTimecode(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(clean)) return null;
  const parts = clean.split(':');
  let total = 0;
  for (const [index, part] of parts.entries()) {
    const value = Number(part);
    // Minutes and seconds after a colon stay below 60.
    if (index > 0 && value >= 60) return null;
    total = total * 60 + value;
  }
  return total;
}

/** How long the kept part is, for progress bars; null when the length is unknown. */
export function trimmedLength(
  duration: number | null,
  options: Record<string, unknown>,
): number | null {
  const trim = readTrim(options);
  if (!trim) return duration;
  const end = trim.end ?? duration;
  return end === null ? null : Math.max(0.1, end - trim.start);
}
