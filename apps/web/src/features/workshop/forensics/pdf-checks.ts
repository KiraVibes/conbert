import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { coverOf, pdfVersions, type CoverColor } from '@conbert/core';
import { openPdf } from '@/lib/pdfjs';

/** Pages checked at most (big documents would take very long). */
const MAX_PAGES = 300;
const SCALE = 1.5;

async function open(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js takes the buffer over to its worker – give it a copy.
  return (await openPdf(bytes.slice())).promise;
}

export interface CoveredText {
  page: number;
  text: string;
  color: CoverColor;
}

export interface RedactionReport {
  pages: number;
  checked: number;
  covered: CoveredText[];
}

/**
 * Renders every page and looks at each text line: if its area is one flat
 * colour, the text is there but hidden under a box (or drawn invisibly).
 */
export async function checkRedactions(
  bytes: Uint8Array,
  onProgress?: (share: number) => void,
): Promise<RedactionReport> {
  const pdfjs = await import('pdfjs-dist');
  const doc = await open(bytes);
  const checked = Math.min(doc.numPages, MAX_PAGES);
  const covered: CoveredText[] = [];
  try {
    for (let n = 1; n <= checked; n++) {
      onProgress?.((n - 1) / checked);
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      // "print" draws in one go – "display" waits for animation frames.
      await page.render({ canvas, viewport, intent: 'print' }).promise;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d canvas');
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const content = await page.getTextContent();
      let last: CoveredText | null = null;
      for (const item of content.items) {
        if (!('str' in item) || !(item as TextItem).str.trim()) continue;
        const t = item as TextItem;
        const tx = pdfjs.Util.transform(viewport.transform, t.transform);
        const size = Math.hypot(tx[2] ?? 0, tx[3] ?? 0);
        const w = t.width * SCALE;
        // The inner part of the line: letters, not the gaps around it.
        const box = {
          x: (tx[4] ?? 0) + w * 0.05,
          y: (tx[5] ?? 0) - size * 0.75,
          w: w * 0.9,
          h: size * 0.6,
        };
        const cover = coverOf(pixels, canvas.width, canvas.height, box);
        if (!cover.covered) {
          last = null;
          continue;
        }
        // Lines next to each other under the same box are one find.
        if (last && last.page === n && last.color === cover.color) last.text += ` ${t.str}`;
        else {
          last = { page: n, text: t.str, color: cover.color };
          covered.push(last);
        }
      }
      page.cleanup();
    }
  } finally {
    void doc.loadingTask.destroy();
  }
  onProgress?.(1);
  return { pages: doc.numPages, checked, covered };
}

export interface VersionInfo {
  number: number;
  bytes: Uint8Array;
  pages: number | null;
  /** Pages whose text differs from the version before (1-based). */
  changed: number[];
  /** First page as a small picture (object URL) – free it when done. */
  thumb: string | null;
}

async function pageTexts(doc: PDFDocumentProxy): Promise<string[]> {
  const out: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    out.push(
      content.items
        .map((i) => ('str' in i ? (i as TextItem).str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    page.cleanup();
  }
  return out;
}

async function thumbOf(doc: PDFDocumentProxy): Promise<string | null> {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 240 / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport, intent: 'print' }).promise;
  page.cleanup();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
  return blob ? URL.createObjectURL(blob) : null;
}

/** The saved states inside a PDF, oldest first, with what changed in each. */
export async function readVersions(bytes: Uint8Array): Promise<VersionInfo[]> {
  const out: VersionInfo[] = [];
  let before: string[] | null = null;
  for (const v of pdfVersions(bytes).slice(-20)) {
    const part = bytes.slice(0, v.end);
    try {
      const doc = await open(part);
      try {
        const texts = await pageTexts(doc);
        const changed = before
          ? texts.flatMap((text, i) => (before?.[i] === text ? [] : [i + 1]))
          : [];
        out.push({
          number: v.number,
          bytes: part,
          pages: doc.numPages,
          changed,
          thumb: await thumbOf(doc),
        });
        before = texts;
      } finally {
        void doc.loadingTask.destroy();
      }
    } catch {
      // A part that doesn't open on its own (e.g. a broken save) still counts.
      out.push({ number: v.number, bytes: part, pages: null, changed: [], thumb: null });
    }
  }
  return out;
}
