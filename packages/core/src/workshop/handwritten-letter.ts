/**
 * A letter in your own handwriting font: text set on A4 pages with small,
 * random irregularities per letter (height, tilt, size, spacing) and per
 * line (slant, start), so it looks written, not printed.
 */

export const LETTER_PAPERS = ['plain', 'lined', 'squared'] as const;
export type LetterPaper = (typeof LETTER_PAPERS)[number];

export const LETTER_INKS = {
  blue: '#1f3a93',
  black: '#1b1b1f',
  royal: '#2952cc',
  sepia: '#5b3a1e',
} as const;
export type LetterInk = keyof typeof LETTER_INKS;

export interface LetterOptions {
  /** Page in mm. */
  pageW: number;
  pageH: number;
  margin: { top: number; right: number; bottom: number; left: number };
  /** Font size in mm (the em). */
  size: number;
  /** Distance between lines in mm. */
  lineHeight: number;
  /** 0 = like printed, 1 = clearly hand-made. */
  wobble: number;
  seed: number;
}

export const DEFAULT_LETTER: LetterOptions = {
  pageW: 210,
  pageH: 297,
  margin: { top: 25, right: 20, bottom: 20, left: 25 },
  size: 9,
  lineHeight: 9,
  wobble: 0.5,
  seed: 1,
};

/** One letter on the page: baseline position (mm from top left), size, tilt. */
export interface PlacedGlyph {
  ch: string;
  x: number;
  y: number;
  size: number;
  /** Tilt in degrees (clockwise). */
  rotate: number;
}

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sets the text: `advance(ch)` is the letter's width in em (font units ÷
 * units per em). Words wrap at the margin, empty lines stay, pages follow.
 */
export function layoutLetter(
  text: string,
  advance: (ch: string) => number,
  o: LetterOptions,
): PlacedGlyph[][] {
  const random = rng(o.seed);
  const r = () => random() * 2 - 1;
  const j = Math.max(0, Math.min(1, o.wobble));
  const width = o.pageW - o.margin.left - o.margin.right;
  const firstLine = o.margin.top + o.size * 0.8;
  const lastLine = o.pageH - o.margin.bottom;
  const pages: PlacedGlyph[][] = [[]];
  let y = firstLine;
  const newLine = () => {
    y += o.lineHeight;
    if (y > lastLine) {
      pages.push([]);
      y = firstLine;
    }
  };
  const wordWidth = (w: string) => [...w].reduce((s, c) => s + advance(c) * o.size, 0);
  const space = advance(' ') * o.size || o.size * 0.3;
  for (const [pi, paragraph] of text.replace(/\r\n?/g, '\n').split('\n').entries()) {
    if (pi > 0) newLine();
    // Each line starts a bit differently and runs a little uphill or downhill.
    let lineStart = o.margin.left + r() * 1.2 * j;
    let slope = r() * 0.006 * j;
    let x = lineStart;
    const words = paragraph.split(/ +/);
    for (const [wi, word] of words.entries()) {
      const ww = wordWidth(word);
      if (wi > 0 && x + space + ww > o.margin.left + width) {
        newLine();
        lineStart = o.margin.left + r() * 1.2 * j;
        slope = r() * 0.006 * j;
        x = lineStart;
      } else if (wi > 0) x += space * (1 + r() * 0.25 * j);
      for (const ch of word) {
        // A word longer than the line is broken.
        const a = advance(ch) * o.size;
        if (x + a > o.margin.left + width + 0.5 && x > lineStart) {
          newLine();
          lineStart = o.margin.left + r() * 1.2 * j;
          slope = r() * 0.006 * j;
          x = lineStart;
        }
        const scale = 1 + r() * 0.05 * j;
        pages.at(-1)?.push({
          ch,
          x,
          y: y + (x - lineStart) * slope + r() * 0.04 * o.size * j,
          size: o.size * scale,
          rotate: r() * 3 * j,
        });
        x += a * scale * (1 + r() * 0.04 * j);
      }
    }
  }
  return pages;
}
