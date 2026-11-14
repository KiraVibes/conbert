/**
 * Strings finder (like the Unix tool "strings"): readable text in any file,
 * with the interesting kinds marked – web addresses, e-mail addresses, IP
 * addresses, file paths and crypto wallet addresses.
 */

export const STRING_KINDS = ['url', 'email', 'ip', 'path', 'crypto'] as const;
export type StringKind = (typeof STRING_KINDS)[number];

export interface FoundString {
  offset: number;
  text: string;
  /** "utf16" = two bytes per letter (Windows programs often store text so). */
  encoding: 'ascii' | 'utf16';
  kinds: StringKind[];
}

export interface StringsResult {
  strings: FoundString[];
  /** Stopped after `max` strings. */
  truncated: boolean;
  counts: Record<StringKind, number>;
}

const PATTERNS: [StringKind, RegExp][] = [
  ['url', /\b(?:https?|ftp|wss?):\/\/[^\s"'<>]{3,}/i],
  ['email', /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/i],
  ['ip', /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/],
  [
    'path',
    /(?:\b[a-z]:\\[^\s"<>|*?]{2,}|\\\\[\w.-]+\\[^\s"<>|*?]+|(?:^|\s)\/(?:home|Users|etc|var|tmp|usr|opt|root|mnt|media)\/[^\s"<>]*)/i,
  ],
  [
    'crypto',
    /\b(?:bc1[ac-hj-np-z02-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40}|4[0-9AB][1-9A-HJ-NP-Za-km-z]{93})\b/,
  ],
];

/** Which kinds a piece of text belongs to. */
export function classifyString(text: string): StringKind[] {
  return PATTERNS.filter(([, re]) => re.test(text)).map(([kind]) => kind);
}

const printable = (b: number) => (b >= 0x20 && b < 0x7f) || b === 0x09;

/**
 * Finds runs of at least `minLength` readable characters – one byte per
 * letter (ASCII) and two bytes per letter (UTF-16 little endian).
 */
export function findStrings(
  bytes: Uint8Array,
  options: { minLength?: number; max?: number; offset?: number } = {},
): StringsResult {
  const min = options.minLength ?? 5;
  const max = options.max ?? 50_000;
  const base = options.offset ?? 0;
  const strings: FoundString[] = [];
  const counts = Object.fromEntries(STRING_KINDS.map((k) => [k, 0])) as Record<StringKind, number>;
  let truncated = false;

  const add = (offset: number, text: string, encoding: FoundString['encoding']) => {
    if (strings.length >= max) {
      truncated = true;
      return;
    }
    const kinds = classifyString(text);
    for (const k of kinds) counts[k]++;
    strings.push({ offset: base + offset, text, encoding, kinds });
  };

  // One byte per letter.
  let start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const ok = i < bytes.length && printable(bytes[i] ?? 0);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (i - start >= min)
        add(
          start,
          String.fromCharCode(...bytes.subarray(start, Math.min(i, start + 4000))),
          'ascii',
        );
      start = -1;
    }
  }
  // Two bytes per letter: a readable byte followed by 0.
  for (const phase of [0, 1]) {
    start = -1;
    for (let i = phase; i <= bytes.length; i += 2) {
      const ok = i + 1 < bytes.length && printable(bytes[i] ?? 0) && bytes[i + 1] === 0;
      if (ok && start < 0) start = i;
      if (!ok && start >= 0) {
        const len = (i - start) / 2;
        if (len >= min) {
          let text = '';
          for (let k = start; k < i && text.length < 4000; k += 2)
            text += String.fromCharCode(bytes[k] ?? 0);
          add(start, text, 'utf16');
        }
        start = -1;
      }
    }
  }
  strings.sort((a, b) => a.offset - b.offset);
  return { strings, truncated, counts };
}
