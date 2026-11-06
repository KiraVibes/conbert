/**
 * Geheimschrift: classic ciphers to play with – and how to crack them.
 * None of them is real encryption (that's the key vault's job).
 */

export const CIPHERS = ['caesar', 'rot13', 'atbash', 'vigenere', 'morse', 'braille'] as const;
export type Cipher = (typeof CIPHERS)[number];

const A = 'A'.charCodeAt(0);
const a = 'a'.charCodeAt(0);

/** Shifts the letters A–Z (umlauts, digits and the rest stay). */
export function caesar(text: string, shift: number): string {
  const k = ((shift % 26) + 26) % 26;
  return text.replace(/[A-Za-z]/g, (c) => {
    const base = c <= 'Z' ? A : a;
    return String.fromCharCode(((c.charCodeAt(0) - base + k) % 26) + base);
  });
}

export const rot13 = (text: string) => caesar(text, 13);

/** A↔Z, B↔Y … (its own inverse). */
export function atbash(text: string): string {
  return text.replace(/[A-Za-z]/g, (c) => {
    const base = c <= 'Z' ? A : a;
    return String.fromCharCode(25 - (c.charCodeAt(0) - base) + base);
  });
}

/** Caesar with a different shift per letter, taken from the key word. */
export function vigenere(text: string, key: string, decrypt = false): string {
  const shifts = [...key.toUpperCase().replace(/[^A-Z]/g, '')].map((c) => c.charCodeAt(0) - A);
  if (shifts.length === 0) return text;
  let i = 0;
  return text.replace(/[A-Za-z]/g, (c) => {
    const shift = shifts[i++ % shifts.length] ?? 0;
    return caesar(c, decrypt ? -shift : shift);
  });
}

// --- Morse -----------------------------------------------------------------

const MORSE: Record<string, string> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  Ä: '.-.-',
  Ö: '---.',
  Ü: '..--',
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  '!': '-.-.--',
  '-': '-....-',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  ':': '---...',
  ';': '-.-.-.',
  '=': '-...-',
  '+': '.-.-.',
  '"': '.-..-.',
  "'": '.----.',
  '@': '.--.-.',
  '&': '.-...',
};
const FROM_MORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

/** Letters → "·−" groups; words separated by " / ". Unknown characters are left out. */
export function toMorse(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((word) =>
      // toUpperCase turns ß into SS – as Morse code usually does too.
      [...word.toUpperCase()]
        .map((c) => MORSE[c] ?? '')
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean)
    .join(' / ');
}

export function fromMorse(code: string): string {
  return code
    .replace(/[·•]/g, '.')
    .replace(/[−–—_]/g, '-')
    .trim()
    .split(/\s*\/\s*|\s{3,}/)
    .map((word) =>
      word
        .split(/\s+/)
        .map((sign) => FROM_MORSE[sign] ?? (sign ? '?' : ''))
        .join(''),
    )
    .join(' ');
}

/** The timing of Morse code in units: dot 1, dash 3, gaps 1 / 3 / 7 – for playing it as sound. */
export function morseTiming(code: string): { on: boolean; units: number }[] {
  const out: { on: boolean; units: number }[] = [];
  const words = code.trim().split(/\s*\/\s*/);
  words.forEach((word, w) => {
    if (w > 0) out.push({ on: false, units: 7 });
    word
      .split(/\s+/)
      .filter(Boolean)
      .forEach((letter, l) => {
        if (l > 0) out.push({ on: false, units: 3 });
        [...letter].forEach((sign, s) => {
          if (s > 0) out.push({ on: false, units: 1 });
          out.push({ on: true, units: sign === '-' ? 3 : 1 });
        });
      });
  });
  return out;
}

// --- Braille (6 dots, German/English base letters) ----------------------------

/** Dots 1–6 per letter, as a bit pattern (dot 1 = bit 0 …), Unicode block U+2800. */
const BRAILLE_LETTERS =
  'a1b12c14d145e15f124g1245h125i24j245k13l123m134n1345o135p1234q12345r1235s234t2345u136v1236w2456x1346y13456z1356';
const BRAILLE: Record<string, number> = {};
for (const m of BRAILLE_LETTERS.matchAll(/([a-z])(\d+)/g)) {
  BRAILLE[m[1] ?? ''] = [...(m[2] ?? '')].reduce((bits, d) => bits | (1 << (Number(d) - 1)), 0);
}
BRAILLE[' '] = 0;
BRAILLE['ä'] = (1 << 2) | (1 << 3) | (1 << 4);
BRAILLE['ö'] = (1 << 1) | (1 << 3) | (1 << 5);
BRAILLE['ü'] = (1 << 0) | (1 << 1) | (1 << 4) | (1 << 5);
BRAILLE['.'] = 1 << 2;
BRAILLE[','] = 1 << 1;
BRAILLE['?'] = (1 << 1) | (1 << 5);
BRAILLE['!'] = (1 << 1) | (1 << 2) | (1 << 4);
const CAPITAL = 1 << 5; // dot 6
const NUMBER = (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5); // dots 3,4,5,6
const DIGIT_LETTERS = 'jabcdefghi';
const cell = (bits: number) => String.fromCharCode(0x2800 + bits);
const FROM_BRAILLE = new Map(Object.entries(BRAILLE).map(([k, v]) => [cell(v), k]));

export function toBraille(text: string): string {
  let out = '';
  let inNumber = false;
  for (const c of text) {
    if (/\d/.test(c)) {
      if (!inNumber) out += cell(NUMBER);
      inNumber = true;
      out += cell(BRAILLE[DIGIT_LETTERS[Number(c)] ?? 'j'] ?? 0);
      continue;
    }
    inNumber = false;
    const lower = c.toLowerCase();
    if (BRAILLE[lower] === undefined) {
      out += c === '\n' ? '\n' : cell(0);
      continue;
    }
    if (c !== lower) out += cell(CAPITAL);
    out += cell(BRAILLE[lower] ?? 0);
  }
  return out;
}

export function fromBraille(text: string): string {
  let out = '';
  let capital = false;
  let number = false;
  for (const c of text) {
    if (c === cell(CAPITAL)) {
      capital = true;
      continue;
    }
    if (c === cell(NUMBER)) {
      number = true;
      continue;
    }
    let letter = FROM_BRAILLE.get(c) ?? (c.charCodeAt(0) >= 0x2800 ? '?' : c);
    if (letter === ' ' || letter === '\n') number = false;
    if (number && DIGIT_LETTERS.includes(letter)) letter = String(DIGIT_LETTERS.indexOf(letter));
    out += capital ? letter.toUpperCase() : letter;
    capital = false;
  }
  return out;
}

// --- Cracking ------------------------------------------------------------------

/** Letter frequencies (%, A–Z) of German and English text. */
const GERMAN = [
  6.51, 1.89, 3.06, 5.08, 17.4, 1.66, 3.01, 4.76, 7.55, 0.27, 1.21, 3.44, 2.53, 9.78, 2.51, 0.79,
  0.02, 7.0, 7.27, 6.15, 4.35, 0.67, 1.89, 0.03, 0.04, 1.13,
];
const ENGLISH = [
  8.17, 1.49, 2.78, 4.25, 12.7, 2.23, 2.02, 6.09, 6.97, 0.15, 0.77, 4.03, 2.41, 6.75, 7.51, 1.93,
  0.1, 5.99, 6.33, 9.06, 2.76, 0.98, 2.36, 0.15, 1.97, 0.07,
];

function counts(text: string): number[] {
  const c = new Array<number>(26).fill(0);
  for (const ch of text.toUpperCase()) {
    const i = ch.charCodeAt(0) - A;
    if (i >= 0 && i < 26) c[i] = (c[i] ?? 0) + 1;
  }
  return c;
}

/**
 * How well the letters fit a language (higher = more like real text): the
 * log-likelihood of the counts. Unlike chi-squared it stays calm on short
 * texts with a rare letter in them.
 */
function fit(c: number[], language: number[]): number {
  return c.reduce(
    (sum, observed, i) => sum + observed * Math.log(Math.max(language[i] ?? 0, 0.05)),
    0,
  );
}

const LANGUAGES = [GERMAN, ENGLISH];
const score = (c: number[]) => Math.max(...LANGUAGES.map((l) => fit(c, l)));

/** Tries all 25 shifts; the most text-like first. */
export function crackCaesar(text: string): { shift: number; text: string }[] {
  return Array.from({ length: 25 }, (_, i) => {
    const shift = i + 1;
    const plain = caesar(text, -shift);
    return { shift, text: plain, score: score(counts(plain)) };
  })
    .sort((x, y) => y.score - x.score)
    .map(({ shift, text: t }) => ({ shift, text: t }));
}

/**
 * Cracks Vigenère: guesses the key length from how often letters repeat
 * (index of coincidence), then each key letter is a Caesar crack of its column.
 */
export function crackVigenere(
  text: string,
  maxKeyLength = 12,
  /** A key length to use instead of guessing it. */
  length?: number,
): { key: string; text: string; longest: number } | null {
  const letters = text.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length < 20) return null;
  const ic = (s: string) => {
    const c = counts(s);
    const n = s.length;
    return n < 2 ? 0 : c.reduce((sum, x) => sum + x * (x - 1), 0) / (n * (n - 1));
  };
  // A column needs some letters for its statistics to mean anything.
  const longest = Math.max(1, Math.min(maxKeyLength, Math.floor(letters.length / 15)));
  const columnIc = (length: number) => {
    let total = 0;
    for (let col = 0; col < length; col++) {
      let column = '';
      for (let i = col; i < letters.length; i += length) column += letters[i];
      total += ic(column);
    }
    return total / length;
  };
  const values = Array.from({ length: longest }, (_, i) => columnIc(i + 1));
  // The right length and its multiples all look like normal text: average over
  // them, then take the shortest length that comes close to the best.
  const scores = values.map((_, i) => {
    const multiples = values.filter((__, j) => (j + 1) % (i + 1) === 0);
    return multiples.reduce((sum, v) => sum + v, 0) / multiples.length;
  });
  const top = Math.max(...scores);
  const best = {
    length:
      length && length >= 1
        ? Math.min(length, letters.length)
        : scores.findIndex((v) => v >= top * 0.95) + 1,
  };
  const columns = Array.from({ length: best.length }, (_, col) => {
    let column = '';
    for (let i = col; i < letters.length; i += best.length) column += letters[i];
    return column;
  });
  // One language for the whole text, so every column is judged the same way.
  let key = '';
  let keyFit = -Infinity;
  for (const language of LANGUAGES) {
    let candidate = '';
    let total = 0;
    for (const column of columns) {
      let bestShift = 0;
      let bestFit = -Infinity;
      for (let shift = 0; shift < 26; shift++) {
        const f = fit(counts(caesar(column, -shift)), language);
        if (f > bestFit) {
          bestFit = f;
          bestShift = shift;
        }
      }
      candidate += String.fromCharCode(A + bestShift);
      total += bestFit;
    }
    if (total > keyFit) {
      keyFit = total;
      key = candidate;
    }
  }
  return { key, text: vigenere(text, key, true), longest };
}
