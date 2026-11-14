import { ConversionError } from '@conbert/core';
import type { FlatPage, PageRef, PdfSource, Rect } from './pdf-ops';
import { renderPageCanvas } from './page-thumbs';

/**
 * The last steps on the PDF page: black out areas (page → picture), stamp a
 * watermark (pdf-lib, on this device) and lock with a password (qpdf on the
 * server – browsers can't encrypt PDFs).
 */

// --- Black out ---------------------------------------------------------------

/** 150 dpi is sharp enough to read and print, and keeps files reasonably small. */
const FLAT_DPI = 150;
const FLAT_MAX_SIDE = 4000;

/** Draws `rects` (fractions of the page) as solid black boxes. */
export function paintRects(ctx: CanvasRenderingContext2D, rects: readonly Rect[]) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#000';
  for (const r of rects) {
    ctx.fillRect(
      Math.floor(r.x * width),
      Math.floor(r.y * height),
      Math.ceil(r.w * width) + 1,
      Math.ceil(r.h * height) + 1,
    );
  }
}

/** The page as a JPEG with its black boxes burnt in. */
export async function flattenPage(source: PdfSource, ref: PageRef): Promise<FlatPage> {
  const probe = await renderPageCanvas(source, ref.index, 10);
  const { width: pw, height: ph } = probe.points;
  const wantW = (pw / 72) * FLAT_DPI;
  const wantH = (ph / 72) * FLAT_DPI;
  const scale = Math.min(1, FLAT_MAX_SIDE / wantW, FLAT_MAX_SIDE / wantH);
  const { canvas } = await renderPageCanvas(source, ref.index, Math.round(wantW * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ConversionError('errors.pdfBroken', 'no canvas');
  paintRects(ctx, ref.redactions ?? []);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.9),
  );
  if (!blob) throw new ConversionError('errors.pdfBroken', 'page picture failed');
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    kind: 'jpg',
    width: pw,
    height: ph,
  };
}

// --- Watermark ---------------------------------------------------------------

export const WATERMARK_POSITIONS = ['diagonal', 'center', 'footer'] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export interface Watermark {
  text: string;
  position: WatermarkPosition;
}

/**
 * Where on the unturned page a point (vx, vy) of the page *as you see it*
 * lies, for a page turned by `rotation` degrees clockwise – and which angle
 * text needs there to look like `angle` on screen.
 */
export function toPageSpace(
  vx: number,
  vy: number,
  angle: number,
  rotation: number,
  width: number,
  height: number,
): { x: number; y: number; angle: number } {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: width - vy, y: vx, angle: angle + 90 };
    case 180:
      return { x: width - vx, y: height - vy, angle: angle + 180 };
    case 270:
      return { x: vy, y: height - vx, angle: angle + 270 };
    default:
      return { x: vx, y: vy, angle };
  }
}

/** Leaves out characters the built-in PDF font can't draw (emoji, Asian scripts …). */
function drawable(text: string, canEncode: (c: string) => boolean): string {
  return [...text].filter((c) => canEncode(c)).join('');
}

/** Stamps a watermark on every page. Returns the new PDF and whether characters had to go. */
export async function addWatermark(
  bytes: Uint8Array,
  mark: Watermark,
): Promise<{ bytes: Uint8Array; dropped: boolean }> {
  const { PDFDocument, StandardFonts, degrees, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = drawable(mark.text.trim(), (c) => {
    try {
      font.encodeText(c);
      return true;
    } catch {
      return false;
    }
  });
  const dropped = text.length < [...mark.text.trim()].length;
  if (!text) return { bytes, dropped };
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const rotation = page.getRotation().angle;
    const sideways = rotation % 180 !== 0;
    const vw = sideways ? height : width;
    const vh = sideways ? width : height;
    const visualAngle = mark.position === 'diagonal' ? (Math.atan2(vh, vw) * 180) / Math.PI : 0;
    const room =
      mark.position === 'diagonal'
        ? Math.hypot(vw, vh) * 0.7
        : mark.position === 'center'
          ? vw * 0.7
          : vw;
    const unit = font.widthOfTextAtSize(text, 1);
    const size =
      mark.position === 'footer'
        ? Math.min(10, room / unit)
        : Math.max(8, Math.min(160, room / unit));
    const textWidth = unit * size;
    const capHeight = font.heightAtSize(size, { descender: false });
    const rad = (visualAngle * Math.PI) / 180;
    // Start of the baseline, so that the text's middle sits on the anchor.
    const [ax, ay] = mark.position === 'footer' ? [vw / 2, 24 + capHeight / 2] : [vw / 2, vh / 2];
    const vx = ax - (textWidth / 2) * Math.cos(rad) + (capHeight / 2) * Math.sin(rad);
    const vy = ay - (textWidth / 2) * Math.sin(rad) - (capHeight / 2) * Math.cos(rad);
    const at = toPageSpace(vx, vy, visualAngle, rotation, width, height);
    page.drawText(text, {
      x: at.x,
      y: at.y,
      size,
      font,
      rotate: degrees(at.angle),
      color: mark.position === 'footer' ? rgb(0.35, 0.35, 0.35) : rgb(0.55, 0.1, 0.1),
      opacity: mark.position === 'footer' ? 0.85 : 0.22,
    });
  }
  return { bytes: await doc.save(), dropped };
}
