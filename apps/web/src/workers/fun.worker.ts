import * as Comlink from 'comlink';
import jsQR from 'jsqr';
import {
  asciiArt,
  channelShift,
  averageColor,
  deepFry,
  emojiMosaic,
  emojisOf,
  glitchJpeg,
  mosaicText,
  pixelArt,
  scaleNearest,
  seededRandom,
  type AsciiArt,
  type AsciiRamp,
  type Dither,
  type EmojiSet,
  type Rgb,
  type Pixels,
  type RetroPalette,
} from '@conbert/core';

/**
 * The workshop's picture fun (ASCII, pixel art, glitch, deep fry) – in a
 * worker, so big pictures don't freeze the page.
 */

async function load(blob: Blob, maxSide: number) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { canvas, ctx, data: ctx.getImageData(0, 0, w, h) };
}

function toCanvas(img: Pixels): OffscreenCanvas {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const data = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  canvas.getContext('2d')?.putImageData(data, 0, 0);
  return canvas;
}

const png = (img: Pixels) => toCanvas(img).convertToBlob({ type: 'image/png' });

/** Whether the browser can still show the bytes as a picture. */
async function decodes(blob: Blob): Promise<boolean> {
  try {
    (await createImageBitmap(blob)).close();
    return true;
  } catch {
    return false;
  }
}

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** Measured emoji colours per set (the device's emoji font decides them). */
const emojiColors = new Map<EmojiSet, { emojis: string[]; colors: Rgb[] }>();

function measureEmojis(set: EmojiSet): { emojis: string[]; colors: Rgb[] } {
  const known = emojiColors.get(set);
  if (known) return known;
  const size = 32;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.font = `${size * 0.8}px ${EMOJI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const emojis: string[] = [];
  const colors: Rgb[] = [];
  for (const emoji of emojisOf(set)) {
    ctx.clearRect(0, 0, size, size);
    ctx.fillText(emoji, size / 2, size / 2);
    const color = averageColor(ctx.getImageData(0, 0, size, size).data);
    // Emojis the device can't draw are left out.
    if (!color) continue;
    emojis.push(emoji);
    colors.push(color);
  }
  const measured = { emojis, colors };
  emojiColors.set(set, measured);
  return measured;
}

const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

const api = {
  async ascii(
    picture: Blob,
    columns: number,
    ramp: AsciiRamp,
    darkBackground: boolean,
  ): Promise<AsciiArt> {
    const { data } = await load(picture, 2000);
    return asciiArt(data, columns, ramp, darkBackground);
  },

  /** The art as a picture (monospace text drawn on a canvas). */
  async asciiPng(art: AsciiArt, colored: boolean, darkBackground: boolean): Promise<Blob> {
    const size = 12;
    const cellW = Math.ceil(size * 0.62);
    const canvas = new OffscreenCanvas(art.columns * cellW + 2 * size, art.rows * size + 2 * size);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = darkBackground ? '#000' : '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${size}px ui-monospace, Consolas, monospace`;
    ctx.textBaseline = 'top';
    art.lines.forEach((line, r) => {
      [...line].forEach((ch, c) => {
        if (ch === ' ') return;
        const k = (r * art.columns + c) * 3;
        ctx.fillStyle = colored
          ? `rgb(${art.colors[k]},${art.colors[k + 1]},${art.colors[k + 2]})`
          : darkBackground
            ? '#fff'
            : '#000';
        ctx.fillText(ch, size + c * cellW, size + r * size);
      });
    });
    return canvas.convertToBlob({ type: 'image/png' });
  },

  /** The small picture and an enlarged copy (about 1000 px wide, sharp edges). */
  async pixelArt(
    picture: Blob,
    width: number,
    palette: RetroPalette,
    dither: Dither,
  ): Promise<{ small: Blob; large: Blob; width: number; height: number; scale: number }> {
    const { data } = await load(picture, 2000);
    const art = pixelArt(data, width, palette, dither);
    const scale = Math.max(1, Math.floor(1024 / art.width));
    return {
      small: await png(art),
      large: await png(scaleNearest(art, scale)),
      width: art.width,
      height: art.height,
      scale,
    };
  },

  /**
   * Emoji-Mosaik: the picture in squares, each one the emoji with the
   * closest colour. Returns the picture and the emojis as text.
   */
  async emojiMosaic(
    picture: Blob,
    columns: number,
    set: EmojiSet,
    background: 'white' | 'black' | 'none',
  ): Promise<{ image: Blob; text: string; columns: number; rows: number }> {
    const { data } = await load(picture, 1600);
    const { emojis, colors } = measureEmojis(set);
    if (emojis.length === 0) throw new Error('no emoji font');
    const mosaic = emojiMosaic(data, columns, colors);
    // Squares of up to 32 px, smaller for huge mosaics (keeps the picture below ~30 MP).
    const cell = Math.max(
      8,
      Math.min(32, Math.floor(Math.sqrt(30_000_000 / (mosaic.columns * mosaic.rows)))),
    );
    const canvas = new OffscreenCanvas(mosaic.columns * cell, mosaic.rows * cell);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    if (background !== 'none') {
      ctx.fillStyle = background === 'white' ? '#fff' : '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.font = `${cell * 0.85}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 0; r < mosaic.rows; r++) {
      for (let c = 0; c < mosaic.columns; c++) {
        const emoji = emojis[mosaic.cells[r * mosaic.columns + c] ?? -1];
        if (emoji) ctx.fillText(emoji, (c + 0.5) * cell, (r + 0.55) * cell);
      }
    }
    return {
      image: await canvas.convertToBlob({ type: 'image/png' }),
      text: mosaicText(mosaic, emojis),
      columns: mosaic.columns,
      rows: mosaic.rows,
    };
  },

  /**
   * Glitch: bytes in the JPEG's picture data are changed. If the result no
   * longer opens, another random pick is tried. Pictures that aren't JPEG are
   * turned into one first.
   */
  async glitch(
    picture: Blob,
    amount: number,
    seed: number,
    shift: number,
  ): Promise<{ image: Blob; ext: 'jpg' | 'png' } | null> {
    let bytes = new Uint8Array(await picture.arrayBuffer());
    const { canvas, data } = await load(picture, 2000);
    const shrunk = data.width * data.height < 0.99 * (await sizeOf(picture));
    if (!isJpeg(bytes) || shrunk) {
      const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      bytes = new Uint8Array(await jpeg.arrayBuffer());
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const glitched = glitchJpeg(bytes, amount, seed + attempt * 7919);
      if (!glitched) return null;
      const blob = new Blob([glitched as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
      if (!(await decodes(blob))) continue;
      if (shift <= 0) return { image: blob, ext: 'jpg' };
      const { data: broken } = await load(blob, 4000);
      return { image: await png(channelShift(broken, shift)), ext: 'png' };
    }
    return null;
  },

  /**
   * Deep fry: strong colours and contrast, then saved as a bad JPEG again and
   * again. The picture moves by a pixel each time, so the 8×8 blocks of the
   * JPEG never line up and every round destroys a bit more.
   */
  async deepFry(picture: Blob, strength: number, generations: number): Promise<Blob> {
    const { data } = await load(picture, 1200);
    const fried = deepFry(data, strength, 1);
    let current: Blob = await toCanvas(fried).convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    const random = seededRandom(generations * 31 + Math.round(strength * 100));
    const { width, height } = data;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    for (let g = 0; g < generations; g++) {
      const bitmap = await createImageBitmap(current);
      const dx = g % 2 === 0 ? 1 : -1;
      ctx.drawImage(bitmap, dx, g % 3 === 0 ? 1 : g % 3 === 1 ? -1 : 0);
      bitmap.close();
      current = await canvas.convertToBlob({
        type: 'image/jpeg',
        quality: 0.2 + random() * 0.4,
      });
    }
    return current;
  },
};

export interface FoundCode {
  text: string;
  /** "qr_code", "ean_13" … */
  format: string;
}

/** The browser's own barcode reader (Chrome on Android/macOS …), if there is one. */
interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string; format: string }[]>;
}
type BarcodeDetectorCtor = new () => BarcodeDetectorLike;

/** QR codes (jsQR) and – where the browser can – barcodes in a picture. */
async function readCodes(picture: Blob): Promise<FoundCode[]> {
  const found: FoundCode[] = [];
  const Detector = (self as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (Detector) {
    try {
      const bitmap = await createImageBitmap(picture);
      for (const code of await new Detector().detect(bitmap)) {
        found.push({ text: code.rawValue, format: code.format });
      }
      bitmap.close();
    } catch {
      // Not supported for this picture – jsQR still tries.
    }
  }
  if (!found.some((f) => f.format === 'qr_code')) {
    // A big photo with a small code reads better at full size, a blurry one smaller.
    for (const side of [1600, 800]) {
      const { data } = await load(picture, side);
      const qr = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
      if (qr) {
        found.push({ text: qr.data, format: 'qr_code' });
        break;
      }
    }
  }
  // The same code from both readers only once.
  return found.filter((f, i) => found.findIndex((g) => g.text === f.text) === i);
}

/** Number of pixels of the original picture. */
async function sizeOf(picture: Blob): Promise<number> {
  const bitmap = await createImageBitmap(picture);
  const n = bitmap.width * bitmap.height;
  bitmap.close();
  return n;
}

/**
 * One icon size: the picture fitted (or cropped) into a square with some
 * free border. Big pictures are halved step by step – one big jump down to
 * 16 px would look grainy.
 */
async function renderIcon(
  picture: Blob,
  size: number,
  padding: number,
  background: string | null,
  fit: 'contain' | 'cover',
): Promise<Blob> {
  let source: ImageBitmap | OffscreenCanvas = await createImageBitmap(picture);
  const sw = source.width;
  const sh = source.height;
  const inner = Math.max(1, Math.round(size * (1 - 2 * padding)));
  const scale = fit === 'contain' ? inner / Math.max(sw, sh) : inner / Math.min(sw, sh);
  // Cover: the middle part of the picture that fills the square.
  const crop =
    fit === 'cover'
      ? {
          x: (sw - inner / scale) / 2,
          y: (sh - inner / scale) / 2,
          w: inner / scale,
          h: inner / scale,
        }
      : { x: 0, y: 0, w: sw, h: sh };
  let cw = crop.w;
  let ch = crop.h;
  let cx = crop.x;
  let cy = crop.y;
  while (cw * scale * 2 < crop.w && Math.max(cw, ch) / 2 >= inner) {
    const half = new OffscreenCanvas(
      Math.max(1, Math.round(cw / 2)),
      Math.max(1, Math.round(ch / 2)),
    );
    const hc = half.getContext('2d');
    if (!hc) break;
    hc.imageSmoothingQuality = 'high';
    hc.drawImage(source, cx, cy, cw, ch, 0, 0, half.width, half.height);
    if (source instanceof ImageBitmap) source.close();
    source = half;
    cw = half.width;
    ch = half.height;
    cx = 0;
    cy = 0;
  }
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.imageSmoothingQuality = 'high';
  const dw = fit === 'contain' ? sw * scale : inner;
  const dh = fit === 'contain' ? sh * scale : inner;
  ctx.drawImage(source, cx, cy, cw, ch, (size - dw) / 2, (size - dh) / 2, dw, dh);
  if (source instanceof ImageBitmap) source.close();
  return canvas.convertToBlob({ type: 'image/png' });
}

const qr = {
  readCodes,
  renderIcon,
};

export type FunWorkerApi = typeof api & typeof qr;
Comlink.expose({ ...api, ...qr });
