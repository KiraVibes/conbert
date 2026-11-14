import { useEffect, useMemo } from 'react';
import {
  MAX_EXIF_THUMB_BYTES,
  diffPixels,
  readExifThumbnail,
  thumbVerdict,
  withExifThumbnail,
  type ThumbVerdict,
} from '@conbert/core';

/** Biggest side of the preview – larger ones rarely fit into the EXIF block. */
const THUMB_SIDE = 320;

function canvas(w: number, h: number): OffscreenCanvas {
  return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function ctx2d(c: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  return ctx;
}

/** Draws `img` so it fills `c` completely (cut at the sides when needed). */
function drawCover(c: OffscreenCanvas, img: ImageBitmap): void {
  const scale = Math.max(c.width / img.width, c.height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const ctx = ctx2d(c);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
}

async function jpegBytes(c: OffscreenCanvas, quality: number): Promise<Uint8Array> {
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The preview prank: `real` is what opens, `preview` what small previews
 * show. The preview is cut to the real picture's side ratio, so nothing gives
 * it away by its shape.
 */
export async function makePrank(real: File, preview: File): Promise<Blob> {
  const [a, b] = await Promise.all([createImageBitmap(real), createImageBitmap(preview)]);
  try {
    const main = canvas(a.width, a.height);
    drawCover(main, a);
    const mainBytes = await jpegBytes(main, 0.92);
    let side = THUMB_SIDE;
    for (;;) {
      const f = side / Math.max(a.width, a.height);
      const thumb = canvas(a.width * f, a.height * f);
      drawCover(thumb, b);
      for (const q of [0.85, 0.7, 0.55]) {
        const bytes = await jpegBytes(thumb, q);
        if (bytes.length <= MAX_EXIF_THUMB_BYTES) {
          return new Blob([withExifThumbnail(mainBytes, bytes) as Uint8Array<ArrayBuffer>], {
            type: 'image/jpeg',
          });
        }
      }
      side = Math.round(side * 0.7);
    }
  } finally {
    a.close();
    b.close();
  }
}

export interface ThumbCheck {
  verdict: ThumbVerdict;
  /** The hidden preview as its own file (null when there is none). */
  thumb: Blob | null;
  /** Share of pixels that differ, 0–1. */
  changed: number;
}

/** Compares a JPEG's EXIF preview with the picture itself. */
export async function checkThumb(file: File): Promise<ThumbCheck> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const thumbBytes = readExifThumbnail(bytes);
  if (!thumbBytes) return { verdict: 'none', thumb: null, changed: 0 };
  const thumb = new Blob([thumbBytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
  const [main, small] = await Promise.all([createImageBitmap(file), createImageBitmap(thumb)]);
  try {
    // Previews are sometimes letterboxed – compare the picture area only.
    const w = small.width;
    const h = small.height;
    const a = canvas(w, h);
    drawCover(a, main);
    const b = canvas(w, h);
    drawCover(b, small);
    const pa = ctx2d(a).getImageData(0, 0, a.width, a.height).data;
    const pb = ctx2d(b).getImageData(0, 0, b.width, b.height).data;
    const diff = diffPixels(pa, pb, 48);
    const changed = diff.changed / (a.width * a.height);
    const aspectGap = Math.abs(Math.log(main.width / main.height / (w / h)));
    return { verdict: thumbVerdict(changed, aspectGap), thumb, changed };
  } finally {
    main.close();
    small.close();
  }
}

/** An object URL for a file or blob, freed when it changes or the page closes. */
export function useObjectUrl(blob: Blob | null): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}
