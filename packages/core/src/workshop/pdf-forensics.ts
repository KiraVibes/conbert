/**
 * PDF forensics: earlier versions inside a PDF (incremental updates) and
 * text that is still there under a black box.
 */

const EOF = [0x25, 0x25, 0x45, 0x4f, 0x46]; // "%%EOF"

export interface PdfVersion {
  /** The version's bytes end here (after "%%EOF" and its line break). */
  end: number;
  /** 1 = the oldest. */
  number: number;
}

/**
 * Editing programs often only append their changes to a PDF ("incremental
 * update"): every save ends with its own "%%EOF". Everything up to such an
 * end is the document as it was saved back then – readable on its own.
 * The first part of a "fast web view" (linearized) PDF also ends with
 * "%%EOF" but is no version of its own, so it is skipped.
 */
export function pdfVersions(bytes: Uint8Array): PdfVersion[] {
  const ends: number[] = [];
  for (let i = 0; i + EOF.length <= bytes.length; i++) {
    if (bytes[i] !== 0x25) continue;
    if (!EOF.every((v, k) => bytes[i + k] === v)) continue;
    let end = i + EOF.length;
    if (bytes[end] === 0x0d) end++;
    if (bytes[end] === 0x0a) end++;
    ends.push(end);
  }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const linearized = /\/Linearized\s/.test(head);
  // A linearized file's first "%%EOF" closes only the first-page part.
  const real = linearized ? ends.slice(1) : ends;
  // Data after the last "%%EOF" that is only padding doesn't make a version.
  return real.map((end, i) => ({ end, number: i + 1 }));
}

export type CoverColor = 'dark' | 'light' | 'color';

export interface Cover {
  covered: boolean;
  color: CoverColor;
}

/**
 * Is the area of a text line (in a rendered page, RGBA) one flat colour? Then
 * the text is drawn but something lies over it – a black (or white) box.
 * Visible text always shows its letters, so its area is never flat.
 */
export function coverOf(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  box: { x: number; y: number; w: number; h: number },
): Cover {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.w));
  const y1 = Math.min(height, Math.ceil(box.y + box.h));
  if (x1 - x0 < 3 || y1 - y0 < 3) return { covered: false, color: 'color' };
  // The middle of the line is the reference colour.
  const mid = (Math.floor((y0 + y1) / 2) * width + Math.floor((x0 + x1) / 2)) * 4;
  const r0 = pixels[mid] ?? 0;
  const g0 = pixels[mid + 1] ?? 0;
  const b0 = pixels[mid + 2] ?? 0;
  let total = 0;
  let same = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * 4;
      const r = pixels[o] ?? 0;
      const g = pixels[o + 1] ?? 0;
      const b = pixels[o + 2] ?? 0;
      total++;
      if (Math.abs(r - r0) + Math.abs(g - g0) + Math.abs(b - b0) < 24) same++;
    }
  }
  const covered = same / total > 0.985;
  const light = (r0 + g0 + b0) / 3;
  return { covered, color: light < 60 ? 'dark' : light > 220 ? 'light' : 'color' };
}
