import * as Comlink from 'comlink';
import {
  detectDocument,
  enhanceScan,
  outputSize,
  rotate90,
  warpPerspective,
  type Quad,
  type ScanFilter,
} from '@conbert/core';

/**
 * The document scanner's picture work – in a worker, because pulling a 12-
 * megapixel photo straight takes a moment and would freeze the page.
 */

/** Photos are worked on at most this size (enough for ~250 dpi on A4, and easy on memory). */
const WORK_SIDE = 3200;
const DETECT_SIDE = 360;
/** Decoded photos kept for quick re-processing (each can be ~40 MB). */
const CACHE = 3;

interface Photo {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

const cache = new Map<string, Photo>();

async function decode(blob: Blob, maxSide: number): Promise<Photo> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { pixels: ctx.getImageData(0, 0, width, height).data, width, height };
}

async function photo(id: string, blob: Blob): Promise<Photo> {
  const known = cache.get(id);
  if (known) {
    // Most recently used last.
    cache.delete(id);
    cache.set(id, known);
    return known;
  }
  const fresh = await decode(blob, WORK_SIDE);
  cache.set(id, fresh);
  while (cache.size > CACHE) cache.delete(cache.keys().next().value as string);
  return fresh;
}

const api = {
  /** Finds the sheet; null corners = set them by hand. Also tells the photo's aspect. */
  async detect(blob: Blob): Promise<{ quad: Quad | null; width: number; height: number }> {
    const small = await decode(blob, DETECT_SIDE);
    return {
      quad: detectDocument(small.pixels, small.width, small.height),
      width: small.width,
      height: small.height,
    };
  },

  /** The straight, cleaned page as JPEG (or PNG for black & white), long side ≤ `maxSide`. */
  async process(
    id: string,
    blob: Blob,
    quad: Quad,
    filter: ScanFilter,
    turns: number,
    maxSide: number,
  ): Promise<{ blob: Blob; width: number; height: number }> {
    const src = await photo(id, blob);
    const size = outputSize(quad, src.width, src.height, maxSide);
    let pixels = warpPerspective(src.pixels, src.width, src.height, quad, size.width, size.height);
    let width = size.width;
    let height = size.height;
    enhanceScan(pixels, width, height, filter);
    for (let i = 0; i < ((turns % 4) + 4) % 4; i++) {
      const turned = rotate90(pixels, width, height);
      pixels = turned.pixels;
      width = turned.width;
      height = turned.height;
    }
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    const out = await canvas.convertToBlob(
      filter === 'bw' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.85 },
    );
    return { blob: out, width, height };
  },

  forget(id: string) {
    cache.delete(id);
  },
};

export type ScannerWorkerApi = typeof api;
Comlink.expose(api);
