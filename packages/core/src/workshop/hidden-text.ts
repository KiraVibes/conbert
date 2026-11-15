/**
 * Hidden text in PDFs: text that is in the file (copy, search and AI tools
 * read it) but a person can't see – white on white, tiny, outside the page.
 * Used to sneak keywords or instructions past application filters.
 */

export const HIDDEN_TEXT_KINDS = ['invisible', 'faint', 'tiny', 'offpage'] as const;
export type HiddenTextKind = (typeof HIDDEN_TEXT_KINDS)[number];

export interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Text smaller than this (in points) nobody reads – normal text is 9–12 pt. */
export const TINY_POINTS = 3;

/**
 * Why a line of text can't be seen, or null if it can. `pixels` is the
 * rendered page (RGBA), `box` the line's letters in it, `points` its size.
 */
export function hiddenTextKind(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  box: TextBox,
  points: number,
): HiddenTextKind | null {
  // Completely outside the page: never printed, never on screen.
  if (box.x + box.w <= 0 || box.y + box.h <= 0 || box.x >= width || box.y >= height)
    return 'offpage';
  if (points < TINY_POINTS) return 'tiny';
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.w));
  const y1 = Math.min(height, Math.ceil(box.y + box.h));
  if (x1 - x0 < 3 || y1 - y0 < 3) return 'tiny';
  // Brightness range inside the line: letters stand out from the paper.
  const values: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * 4;
      const v =
        0.299 * (pixels[o] ?? 0) + 0.587 * (pixels[o + 1] ?? 0) + 0.114 * (pixels[o + 2] ?? 0);
      values.push(v);
    }
  }
  values.sort((a, b) => a - b);
  // Robust ends: a stray pixel doesn't count as a letter.
  const lo = values[Math.floor(values.length * 0.01)] ?? 0;
  const hi = values[Math.floor(values.length * 0.99)] ?? 0;
  const range = hi - lo;
  if (range < 6) return 'invisible';
  // Very pale letters (e.g. light grey on white): hard to see but there.
  if (range < 40) return 'faint';
  return null;
}
