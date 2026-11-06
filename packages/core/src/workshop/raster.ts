import { unzlibSync, zlibSync } from 'fflate';
import { crc32 } from './crc';
import { u16le, u32be, u32le } from './reader';

/**
 * A tiny lossless picture reader/writer for the hiding tricks: PNG (8 bit,
 * not interlaced) and BMP (24/32 bit). Pixels must come back bit for bit,
 * which a browser canvas does not promise (colour management, alpha).
 */

export interface Raster {
  width: number;
  height: number;
  /** 3 = RGB, 4 = RGBA; one byte per channel, rows top to bottom. */
  channels: 3 | 4;
  data: Uint8Array;
}

/** Large enough for big photos, small enough not to run out of memory. */
export const MAX_PIXELS = 50_000_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

export function isBmp(bytes: Uint8Array): boolean {
  return bytes[0] === 0x42 && bytes[1] === 0x4d;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** null = a PNG this reader doesn't handle (16 bit, interlaced, damaged …). */
export function decodePng(bytes: Uint8Array): Raster | null {
  if (!isPng(bytes)) return null;
  let p = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = -1;
  let palette: Uint8Array | null = null;
  let alphas: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p + 8 <= bytes.length) {
    const length = u32be(bytes, p);
    const name = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const body = bytes.subarray(p + 8, p + 8 + length);
    if (name === 'IHDR') {
      width = u32be(body, 0);
      height = u32be(body, 4);
      depth = body[8] ?? 0;
      type = body[9] ?? -1;
      if ((body[12] ?? 0) !== 0) return null; // interlaced
    } else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') alphas = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    p += 12 + length;
  }
  if (depth !== 8 || ![0, 2, 3, 4, 6].includes(type)) return null;
  if (width === 0 || height === 0 || width * height > MAX_PIXELS) return null;
  const perPixel = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type as 0 | 2 | 3 | 4 | 6];
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of idat) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  let raw: Uint8Array;
  try {
    raw = unzlibSync(joined);
  } catch {
    return null;
  }
  const stride = width * perPixel;
  if (raw.length < height * (stride + 1)) return null;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x] ?? 0;
      const a = x >= perPixel ? (rows[dst + x - perPixel] ?? 0) : 0;
      const b = y > 0 ? (rows[dst - stride + x] ?? 0) : 0;
      const c = x >= perPixel && y > 0 ? (rows[dst - stride + x - perPixel] ?? 0) : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = v;
          break;
        case 1:
          out = v + a;
          break;
        case 2:
          out = v + b;
          break;
        case 3:
          out = v + ((a + b) >> 1);
          break;
        case 4:
          out = v + paeth(a, b, c);
          break;
        default:
          return null;
      }
      rows[dst + x] = out & 0xff;
    }
  }
  const hasAlpha = type === 4 || type === 6 || (type === 3 && alphas !== null);
  const channels: 3 | 4 = hasAlpha ? 4 : 3;
  if (type === 2 && !hasAlpha) return { width, height, channels, data: rows };
  if (type === 6) return { width, height, channels, data: rows };
  const data = new Uint8Array(width * height * channels);
  for (let i = 0; i < width * height; i++) {
    let r: number;
    let g: number;
    let b: number;
    let alpha = 255;
    if (type === 3) {
      const index = rows[i] ?? 0;
      r = palette?.[index * 3] ?? 0;
      g = palette?.[index * 3 + 1] ?? 0;
      b = palette?.[index * 3 + 2] ?? 0;
      alpha = alphas?.[index] ?? 255;
    } else if (type === 4) {
      r = g = b = rows[i * 2] ?? 0;
      alpha = rows[i * 2 + 1] ?? 255;
    } else {
      r = g = b = rows[i] ?? 0;
    }
    data[i * channels] = r;
    data[i * channels + 1] = g;
    data[i * channels + 2] = b;
    if (channels === 4) data[i * channels + 3] = alpha;
  }
  return { width, height, channels, data };
}

function chunk(name: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** Writes an 8-bit RGB/RGBA PNG (rows with the "Sub" filter, which suits noisy pixels). */
export function encodePng(raster: Raster): Uint8Array {
  const { width, height, channels, data } = raster;
  const stride = width * channels;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const dst = y * (stride + 1);
    raw[dst] = 1;
    for (let x = 0; x < stride; x++) {
      const v = data[y * stride + x] ?? 0;
      const left = x >= channels ? (data[y * stride + x - channels] ?? 0) : 0;
      raw[dst + 1 + x] = (v - left) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  const parts = [
    Uint8Array.from(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** BMP with 24 or 32 bits per pixel, uncompressed (BI_RGB / BI_BITFIELDS). */
export function decodeBmp(bytes: Uint8Array): Raster | null {
  if (!isBmp(bytes) || bytes.length < 54) return null;
  const offset = u32le(bytes, 10);
  const headerSize = u32le(bytes, 14);
  if (headerSize < 40) return null;
  const width = u32le(bytes, 18) | 0;
  const rawHeight = u32le(bytes, 22) | 0;
  const bits = u16le(bytes, 28);
  const compression = u32le(bytes, 30);
  if (width <= 0 || rawHeight === 0) return null;
  if (
    !(bits === 24 && compression === 0) &&
    !(bits === 32 && (compression === 0 || compression === 3))
  ) {
    return null;
  }
  const height = Math.abs(rawHeight);
  if (width * height > MAX_PIXELS) return null;
  const topDown = rawHeight < 0;
  const perPixel = bits / 8;
  const stride = Math.ceil((width * perPixel) / 4) * 4;
  if (offset + stride * height > bytes.length) return null;
  // 32-bit BMPs often leave the 4th byte unused; it only counts as alpha
  // when a header says so.
  const alphaMask = bits === 32 && headerSize >= 56 ? u32le(bytes, 14 + 52) : 0;
  const channels: 3 | 4 = bits === 32 && alphaMask === 0xff000000 ? 4 : 3;
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const row = offset + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const s = row + x * perPixel;
      const d = (y * width + x) * channels;
      data[d] = bytes[s + 2] ?? 0;
      data[d + 1] = bytes[s + 1] ?? 0;
      data[d + 2] = bytes[s] ?? 0;
      if (channels === 4) data[d + 3] = bytes[s + 3] ?? 255;
    }
  }
  return { width, height, channels, data };
}

/** Writes a 24-bit BMP (alpha is dropped – use PNG for transparent pictures). */
export function encodeBmp(raster: Raster): Uint8Array {
  const { width, height, channels, data } = raster;
  const stride = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + stride * height;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, size, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, stride * height, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  for (let y = 0; y < height; y++) {
    const row = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * channels;
      out[row + x * 3] = data[s + 2] ?? 0;
      out[row + x * 3 + 1] = data[s + 1] ?? 0;
      out[row + x * 3 + 2] = data[s] ?? 0;
    }
  }
  return out;
}

/** PNG or BMP → pixels; null for anything else (the browser decodes those). */
export function decodeRaster(bytes: Uint8Array): Raster | null {
  if (isPng(bytes)) return decodePng(bytes);
  if (isBmp(bytes)) return decodeBmp(bytes);
  return null;
}
