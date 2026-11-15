import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import {
  coverOf,
  hiddenTextKind,
  pdfVersions,
  type CoverColor,
  type HiddenTextKind,
} from '@conbert/core';
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

interface TextLine {
  text: string;
  /** The inner part of the line (letters, not the gaps around it) in page pixels. */
  box: { x: number; y: number; w: number; h: number };
  /** Font size in points. */
  points: number;
}

/**
 * Renders every page and hands each text line with the page's pixels to
 * `visit` – the checks below look at what the line's area really shows.
 */
async function scanTextLines(
  bytes: Uint8Array,
  visit: (
    page: number,
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    line: TextLine,
  ) => void,
  onProgress?: (share: number) => void,
): Promise<{ pages: number; checked: number }> {
  const pdfjs = await import('pdfjs-dist');
  const doc = await open(bytes);
  const checked = Math.min(doc.numPages, MAX_PAGES);
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
      for (const item of content.items) {
        if (!('str' in item) || !(item as TextItem).str.trim()) continue;
        const t = item as TextItem;
        const tx = pdfjs.Util.transform(viewport.transform, t.transform);
        const size = Math.hypot(tx[2] ?? 0, tx[3] ?? 0);
        const w = t.width * SCALE;
        visit(n, pixels, canvas.width, canvas.height, {
          text: t.str,
          box: {
            x: (tx[4] ?? 0) + w * 0.05,
            y: (tx[5] ?? 0) - size * 0.75,
            w: w * 0.9,
            h: size * 0.6,
          },
          points: Math.hypot(t.transform[2] ?? 0, t.transform[3] ?? 0),
        });
      }
      page.cleanup();
    }
  } finally {
    void doc.loadingTask.destroy();
  }
  onProgress?.(1);
  return { pages: doc.numPages, checked };
}

/**
 * Looks at each text line: if its area is one flat colour, the text is
 * there but hidden under a box (or drawn invisibly).
 */
export async function checkRedactions(
  bytes: Uint8Array,
  onProgress?: (share: number) => void,
): Promise<RedactionReport> {
  const covered: CoveredText[] = [];
  let last: CoveredText | null = null;
  const done = await scanTextLines(
    bytes,
    (n, pixels, width, height, line) => {
      const cover = coverOf(pixels, width, height, line.box);
      if (!cover.covered) {
        last = null;
        return;
      }
      // Lines next to each other under the same box are one find.
      if (last && last.page === n && last.color === cover.color) last.text += ` ${line.text}`;
      else {
        last = { page: n, text: line.text, color: cover.color };
        covered.push(last);
      }
    },
    onProgress,
  );
  return { ...done, covered };
}

export interface HiddenText {
  page: number;
  text: string;
  kind: HiddenTextKind;
}

export interface HiddenTextReport {
  pages: number;
  checked: number;
  found: HiddenText[];
}

/**
 * Text people can't see but machines read: white on white, very pale,
 * tiny or outside the page. Text under a black box is the redaction
 * check's business and isn't counted here.
 */
export async function findHiddenText(
  bytes: Uint8Array,
  onProgress?: (share: number) => void,
): Promise<HiddenTextReport> {
  const found: HiddenText[] = [];
  let last: HiddenText | null = null;
  const done = await scanTextLines(
    bytes,
    (n, pixels, width, height, line) => {
      const kind = hiddenTextKind(pixels, width, height, line.box, line.points);
      const blackBox =
        kind === 'invisible' && coverOf(pixels, width, height, line.box).color === 'dark';
      if (!kind || blackBox) {
        last = null;
        return;
      }
      if (last && last.page === n && last.kind === kind) last.text += ` ${line.text}`;
      else {
        last = { page: n, text: line.text, kind };
        found.push(last);
      }
    },
    onProgress,
  );
  return { ...done, found: [...found, ...(await offPageText(bytes))] };
}

/**
 * Text completely outside the page. pdf.js leaves it out of its text list,
 * but other programs (copy, search, application filters, AI) read it. So a
 * copy with much bigger page boxes is read and compared with the real box.
 */
async function offPageText(bytes: Uint8Array): Promise<HiddenText[]> {
  const out: HiddenText[] = [];
  try {
    const { PDFDocument } = await import('pdf-lib');
    const copy = await PDFDocument.load(bytes, { updateMetadata: false });
    const boxes = copy
      .getPages()
      .slice(0, MAX_PAGES)
      .map((p) => {
        const b = p.getCropBox();
        const m = 5000;
        p.setMediaBox(b.x - m, b.y - m, b.width + 2 * m, b.height + 2 * m);
        p.setCropBox(b.x - m, b.y - m, b.width + 2 * m, b.height + 2 * m);
        return b;
      });
    const doc = await open(await copy.save());
    try {
      for (const [i, b] of boxes.entries()) {
        const page = await doc.getPage(i + 1);
        const content = await page.getTextContent();
        let last: HiddenText | null = null;
        for (const item of content.items) {
          if (!('str' in item) || !(item as TextItem).str.trim()) continue;
          const t = item as TextItem;
          const x = t.transform[4] ?? 0;
          const y = t.transform[5] ?? 0;
          const outside =
            x + t.width <= b.x || x >= b.x + b.width || y + t.height <= b.y || y >= b.y + b.height;
          if (!outside) {
            last = null;
            continue;
          }
          if (last) last.text += ` ${t.str}`;
          else {
            last = { page: i + 1, text: t.str, kind: 'offpage' };
            out.push(last);
          }
        }
        page.cleanup();
      }
    } finally {
      void doc.loadingTask.destroy();
    }
  } catch (e) {
    // Encrypted or unusual PDFs: the on-page checks above still count.
    console.warn('off-page check skipped', e);
  }
  return out;
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
