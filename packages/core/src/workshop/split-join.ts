/**
 * Datei-Splitter/Joiner: a file cut into parts of the same size
 * ("film.mp4.001", "film.mp4.002" …) and put back together. The naming is
 * the one 7-Zip uses for split files, so 7-Zip can join the parts as well.
 */

const MB = 1024 * 1024;

/** Sizes people often need (messengers, e-mail, upload forms). */
export const SPLIT_PRESETS_MB = [10, 25, 50, 100, 500, 1000] as const;

export const SPLIT_MIN_MB = 1;
export const SPLIT_MAX_MB = 4000;
/** Three digits in the name – 7-Zip counts up to 999. */
export const SPLIT_MAX_PARTS = 999;

export interface SplitPart {
  /** 1-based. */
  number: number;
  name: string;
  start: number;
  end: number;
}

/** "film.mp4", 3 → "film.mp4.003". */
export function partName(fileName: string, number: number): string {
  return `${fileName}.${String(number).padStart(3, '0')}`;
}

/**
 * Where each part starts and ends. Null when the parts would be too many
 * (more than 999) or the size makes no sense.
 */
export function splitPlan(fileName: string, size: number, partBytes: number): SplitPart[] | null {
  if (!Number.isFinite(partBytes) || partBytes < 1 || size < 1) return null;
  const count = Math.ceil(size / partBytes);
  if (count > SPLIT_MAX_PARTS) return null;
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    name: partName(fileName, i + 1),
    start: i * partBytes,
    end: Math.min(size, (i + 1) * partBytes),
  }));
}

/** Megabytes from the form → bytes (whole bytes, at least 1 MB). */
export const megabytes = (mb: number) => Math.round(Math.max(SPLIT_MIN_MB, mb) * MB);

/** "film.mp4.002" → { base: "film.mp4", number: 2 }; null for other names. */
export function parsePartName(name: string): { base: string; number: number } | null {
  const match = /^(.+)\.(\d{3,})$/.exec(name);
  if (!match?.[1] || !match[2]) return null;
  const number = Number.parseInt(match[2], 10);
  return number >= 1 ? { base: match[1], number } : null;
}

export type JoinProblem =
  /** No name ends in .001, .002 … */
  | { kind: 'notParts' }
  /** Parts of different files were chosen together. */
  | { kind: 'mixed'; bases: string[] }
  /** The same part twice. */
  | { kind: 'duplicate'; number: number }
  /** A part in the middle (or the first) is missing. */
  | { kind: 'missing'; numbers: number[] };

export interface JoinPlan<T> {
  /** Name of the joined file ("film.mp4"). */
  name: string;
  /** The parts in the right order. */
  parts: T[];
  /**
   * The last part is as big as the others – maybe more follow. Only a hint:
   * the file can be exactly a multiple of the part size.
   */
  maybeIncomplete: boolean;
}

/**
 * Puts chosen parts in order and checks that none is missing. `nameOf` and
 * `sizeOf` read a part (File in the browser, plain objects in tests).
 */
export function joinPlan<T>(
  parts: readonly T[],
  nameOf: (part: T) => string,
  sizeOf: (part: T) => number,
): { ok: true; plan: JoinPlan<T> } | { ok: false; problem: JoinProblem } {
  const parsed = parts.map((part) => ({ part, info: parsePartName(nameOf(part)) }));
  if (parsed.length === 0 || parsed.some((p) => !p.info))
    return { ok: false, problem: { kind: 'notParts' } };
  const bases = [...new Set(parsed.map((p) => p.info?.base ?? ''))];
  if (bases.length > 1) return { ok: false, problem: { kind: 'mixed', bases } };
  const sorted = [...parsed].sort((a, b) => (a.info?.number ?? 0) - (b.info?.number ?? 0));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]?.info?.number === sorted[i - 1]?.info?.number) {
      return { ok: false, problem: { kind: 'duplicate', number: sorted[i]?.info?.number ?? 0 } };
    }
  }
  const last = sorted.at(-1)?.info?.number ?? 0;
  const have = new Set(sorted.map((p) => p.info?.number));
  const missing: number[] = [];
  for (let n = 1; n <= last; n++) if (!have.has(n)) missing.push(n);
  if (missing.length > 0) return { ok: false, problem: { kind: 'missing', numbers: missing } };
  const ordered = sorted.map((p) => p.part);
  const sizes = ordered.map(sizeOf);
  const first = sizes[0] ?? 0;
  const lastSize = sizes.at(-1) ?? 0;
  return {
    ok: true,
    plan: {
      name: bases[0] ?? 'joined',
      parts: ordered,
      // A single part: only suspicious when it is a whole number of megabytes.
      maybeIncomplete: sizes.length === 1 ? first % MB === 0 : lastSize === first,
    },
  };
}
