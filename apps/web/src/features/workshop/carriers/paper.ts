import { splitForCarrier, type CarriedFile } from '@conbert/core';

/** Bytes per QR code – small enough for phone photos of a whole page. */
const PIECE = 340;
const COLS = 4;
const ROWS = 5;
const W = 595.28;
const H = 841.89;
const MARGIN = 36;
const CELL = (W - 2 * MARGIN) / COLS;
const TOP = H - MARGIN - 40;

/**
 * Where the QR codes sit on a page, as shares of the page (0–1, top left
 * origin) – the reader crops these cells after straightening a photo.
 */
export const PAPER_CELLS: { x: number; y: number; w: number; h: number }[] = Array.from(
  { length: COLS * ROWS },
  (_, i) => {
    const x = MARGIN + (i % COLS) * CELL;
    const y = TOP - (Math.floor(i / COLS) + 1) * (CELL + 8);
    // PDF y grows upwards; the cell box is [y, y + CELL + 8].
    return { x: x / W, y: 1 - (y + CELL + 8) / H, w: CELL / W, h: (CELL + 8) / H };
  },
);
export const PAPER_PER_PAGE = COLS * ROWS;
/** Biggest file (after packing) – about 60 pages. */
export const PAPER_MAX_PIECES = 60 * PAPER_PER_PAGE;

async function qrPng(data: Uint8Array): Promise<Uint8Array> {
  const QRCode = await import('qrcode');
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, [{ data, mode: 'byte' }], {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 4,
  });
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('qr failed');
  return new Uint8Array(await blob.arrayBuffer());
}

export interface PaperTexts {
  title: string;
  page: (n: number, of: number) => string;
  restore: string;
}

/** The file as a printable PDF: a grid of numbered QR codes per A4 page. */
export async function makePaperPdf(
  file: CarriedFile,
  texts: PaperTexts,
  onProgress: (share: number) => void,
): Promise<{ pdf: Uint8Array; pages: number; codes: number }> {
  const pieces = splitForCarrier(file, PIECE);
  if (pieces.length > PAPER_MAX_PIECES) throw new RangeError('too big');
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = Math.ceil(pieces.length / PAPER_PER_PAGE);
  // Standard fonts only know Latin-1: keep the name printable.
  const safe = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
  const margin = MARGIN;
  const cell = CELL;
  const top = TOP;
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([W, H]);
    page.drawText(safe(`${texts.title}: ${file.name}`), {
      x: margin,
      y: H - margin - 10,
      size: 12,
      font: bold,
    });
    page.drawText(safe(`${texts.page(p + 1, pages)} · ${texts.restore}`), {
      x: margin,
      y: H - margin - 26,
      size: 8,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
    for (let i = 0; i < PAPER_PER_PAGE; i++) {
      const n = p * PAPER_PER_PAGE + i;
      const piece = pieces[n];
      if (!piece) break;
      const png = await doc.embedPng(await qrPng(piece));
      const x = margin + (i % COLS) * cell;
      const y = top - (Math.floor(i / COLS) + 1) * (cell + 8);
      const size = cell - 10;
      page.drawImage(png, { x: x + 5, y: y + 10, width: size, height: size });
      page.drawText(`${n + 1}/${pieces.length}`, {
        x: x + 5 + size / 2 - 12,
        y: y + 2,
        size: 7,
        font,
      });
      onProgress((n + 1) / pieces.length);
    }
  }
  return { pdf: await doc.save(), pages, codes: pieces.length };
}

/** Pages of a scanned PDF as pictures (for the QR search). */
export async function pdfPagesAsImages(file: Blob): Promise<Blob[]> {
  const { openPdf } = await import('@/lib/pdfjs');
  const doc = await (await openPdf(file)).promise;
  const out: Blob[] = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, 80); n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 3 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, intent: 'print' }).promise;
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (blob) out.push(blob);
      page.cleanup();
    }
  } finally {
    void doc.loadingTask.destroy();
  }
  return out;
}
