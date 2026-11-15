import * as Comlink from 'comlink';
import jsQR from 'jsqr';
import { PAPER_CELLS } from '@/features/workshop/carriers/paper';
import {
  blobReader,
  audioCuts,
  cleanOffice,
  copyMove,
  dangerCheck,
  forensicFilter,
  findStrings,
  inspectProgram,
  luminance,
  readOfficeSecrets,
  detectDocument,
  warpPerspective,
  floatWav,
  sstvDecode,
  sstvEncode,
  SSTV_SPECS,
  type SstvMode,
  type SstvPicture,
  recoverCroppedPng,
  type CleanOptions,
  type CutReport,
  type CopyMoveRegion,
  type ForensicFilter,
  type CropRecovery,
  type OfficeSecrets,
  type DangerReport,
  type ProgramInfo,
  type StringsResult,
  findCornerMarkers,
  glyphFromCell,
  cellWritingArea,
  markerCenters,
  HANDWRITING_CHARS,
  type Glyph,
} from '@conbert/core';

/**
 * Forensic checks that read a whole file or try many possibilities (e.g. a
 * cropped screenshot's lost rest) – in a worker, so the page stays usable.
 */

/** Programs and string searches read at most this much of a file. */
const READ_LIMIT = 256 * 1024 * 1024;

const head = async (file: Blob) =>
  new Uint8Array(await file.slice(0, Math.min(file.size, READ_LIMIT)).arrayBuffer());

interface Picture {
  pixels: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** Decodes a picture, at most `maxSide` pixels on its longest side. */
async function decode(file: Blob, maxSide: number): Promise<Picture> {
  const bitmap = await createImageBitmap(file);
  const f = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * f));
  const height = Math.max(1, Math.round(bitmap.height * f));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { pixels: ctx.getImageData(0, 0, width, height).data, width, height };
}

/** The magnifier keeps its picture, the sliders only re-run the filter. */
let kept: { file: Blob; picture: Picture } | null = null;

/** Straightened handwriting sheets: pixels per mm. */
const SHEET_PX = 8;

export interface HandwritingResult {
  /** One per character of the sheet (null = box left empty). */
  glyphs: (Glyph | null)[];
  /** The straightened sheet (greyscale) between the corner squares, for a look. */
  page: {
    gray: Uint8Array;
    width: number;
    height: number;
    pxPerMm: number;
    originMm: [number, number];
  };
}

const api = {
  /**
   * A photo or scan of the filled handwriting sheet → one outline per box.
   * Null when the four corner squares can't be found.
   */
  async handwriting(file: Blob): Promise<HandwritingResult | null> {
    const photo = await decode(file, 3200);
    // Look for the squares in a smaller copy (fast), then map back.
    const f = Math.min(1, 1200 / Math.max(photo.width, photo.height));
    const sw = Math.max(1, Math.round(photo.width * f));
    const sh = Math.max(1, Math.round(photo.height * f));
    const small = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        const o =
          (Math.min(photo.height - 1, Math.floor(y / f)) * photo.width +
            Math.min(photo.width - 1, Math.floor(x / f))) *
          4;
        small[y * sw + x] =
          ((photo.pixels[o] ?? 0) * 299 +
            (photo.pixels[o + 1] ?? 0) * 587 +
            (photo.pixels[o + 2] ?? 0) * 114) /
          1000;
      }
    const marks = findCornerMarkers(small, sw, sh);
    if (!marks) return null;
    const centers = markerCenters();
    const [c0, , c2] = centers;
    if (!c0 || !c2) return null;
    const widthMm = c2[0] - c0[0];
    const heightMm = c2[1] - c0[1];
    const width = Math.round(widthMm * SHEET_PX);
    const height = Math.round(heightMm * SHEET_PX);
    const quad = marks.map((m) => ({ x: m.x / sw, y: m.y / sh })) as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    const rgba = warpPerspective(photo.pixels, photo.width, photo.height, quad, width, height);
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++)
      gray[i] =
        ((rgba[i * 4] ?? 0) * 299 + (rgba[i * 4 + 1] ?? 0) * 587 + (rgba[i * 4 + 2] ?? 0) * 114) /
        1000;
    const glyphs = HANDWRITING_CHARS.map((_, i) => {
      const a = cellWritingArea(i);
      const x0 = Math.round((a.x - c0[0]) * SHEET_PX);
      const y0 = Math.round((a.y - c0[1]) * SHEET_PX);
      const cw = Math.round(a.w * SHEET_PX);
      const ch = Math.round(a.h * SHEET_PX);
      const cell = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) cell[y * cw + x] = gray[(y0 + y) * width + x0 + x] ?? 255;
      return glyphFromCell(cell, cw, ch, SHEET_PX);
    });
    return Comlink.transfer(
      { glyphs, page: { gray, width, height, pxPerMm: SHEET_PX, originMm: c0 } },
      [gray.buffer],
    );
  },
  async copyMove(
    file: Blob,
  ): Promise<{ regions: CopyMoveRegion[]; mask: Uint8Array; width: number; height: number }> {
    const { pixels, width, height } = await decode(file, 768);
    const r = copyMove(luminance(pixels, width, height), width, height);
    return Comlink.transfer({ ...r, width, height }, [r.mask.buffer]);
  },
  async filter(file: Blob, filter: ForensicFilter, amount: number): Promise<Picture> {
    if (kept?.file !== file) kept = { file, picture: await decode(file, 1600) };
    const { width, height } = kept.picture;
    const pixels = forensicFilter(kept.picture.pixels, width, height, filter, amount);
    return Comlink.transfer({ pixels, width, height }, [pixels.buffer]);
  },
  async recoverCrop(file: Blob, onProgress?: (share: number) => void): Promise<CropRecovery> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = recoverCroppedPng(bytes, onProgress);
    return result.status === 'recovered'
      ? Comlink.transfer(result, [result.pixels.buffer, result.marked.buffer])
      : result;
  },
  danger(file: Blob, name: string, detectedExt: string | null): Promise<DangerReport> {
    return dangerCheck(blobReader(file), name, detectedExt);
  },
  async program(file: Blob): Promise<ProgramInfo | null> {
    return inspectProgram(await head(file));
  },
  officeSecrets(file: Blob): Promise<OfficeSecrets> {
    return readOfficeSecrets(blobReader(file));
  },
  async cleanOffice(file: Blob, options: CleanOptions): Promise<Uint8Array> {
    const bytes = await cleanOffice(blobReader(file), options);
    return Comlink.transfer(bytes, [bytes.buffer]);
  },
  /** The picture, cut to the mode's size, as SSTV sound (WAV). */
  async sstvSend(file: Blob, mode: SstvMode): Promise<Uint8Array> {
    const { width, height } = SSTV_SPECS[mode];
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas');
    // Fill the frame: cut the picture at the sides or top as needed.
    const scale = Math.max(width / bitmap.width, height / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
    bitmap.close();
    const rate = 22050;
    const wav = floatWav(sstvEncode(ctx.getImageData(0, 0, width, height).data, mode, rate), rate);
    return Comlink.transfer(wav, [wav.buffer]);
  },
  sstvReceive(samples: Float32Array, rate: number, fallback: SstvMode): SstvPicture | null {
    const picture = sstvDecode(samples, rate, fallback);
    return picture ? Comlink.transfer(picture, [picture.pixels.buffer]) : null;
  },
  /**
   * All QR codes on a page photo or scan. jsQR finds one code per picture:
   * the page is straightened (photos) and each cell of the paper-backup
   * grid is read on its own; overlapping windows catch the rest.
   */
  async findQr(file: Blob): Promise<Uint8Array[]> {
    const photo = await decode(file, 2400);
    const found = new Map<string, Uint8Array>();
    const look = (pic: Picture, x0: number, y0: number, w: number, h: number) => {
      x0 = Math.max(0, Math.round(x0));
      y0 = Math.max(0, Math.round(y0));
      w = Math.min(Math.round(w), pic.width - x0);
      h = Math.min(Math.round(h), pic.height - y0);
      if (w < 40 || h < 40) return;
      const crop = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++)
        crop.set(
          pic.pixels.subarray(((y0 + y) * pic.width + x0) * 4, ((y0 + y) * pic.width + x0 + w) * 4),
          y * w * 4,
        );
      const code = jsQR(crop, w, h, { inversionAttempts: 'attemptBoth' });
      if (code && code.binaryData.length > 0) {
        const bytes = new Uint8Array(code.binaryData);
        found.set(bytes.join(','), bytes);
      }
    };
    // A photo of a sheet: pull the sheet straight first (A4 shape).
    const quad = detectDocument(photo.pixels, photo.width, photo.height);
    const pages: Picture[] = [photo];
    if (quad) {
      const w = 1400;
      const h = Math.round(w * 1.4142);
      pages.unshift({
        pixels: warpPerspective(photo.pixels, photo.width, photo.height, quad, w, h),
        width: w,
        height: h,
      });
    }
    for (const page of pages) {
      for (const c of PAPER_CELLS) {
        // A little extra around each cell – printers and photos are never exact.
        const pad = 0.12;
        look(
          page,
          (c.x - c.w * pad) * page.width,
          (c.y - c.h * pad) * page.height,
          c.w * (1 + 2 * pad) * page.width,
          c.h * (1 + 2 * pad) * page.height,
        );
      }
    }
    // Both readings count (a sheet found by mistake must not hide the codes).
    if (found.size > 0) return [...found.values()];
    // Not a paper-backup page (or a very skewed photo): search in windows.
    for (const part of [2, 3, 4, 5]) {
      const size = Math.round((Math.min(photo.width, photo.height) / part) * 1.3);
      const step = Math.max(16, Math.round(size / 4));
      for (let y = 0; y < photo.height; y += step)
        for (let x = 0; x < photo.width; x += step) look(photo, x, y, size, size);
    }
    return [...found.values()];
  },
  cuts(samples: Float32Array, rate: number): CutReport {
    return audioCuts(samples, rate);
  },
  async strings(file: Blob, minLength: number): Promise<StringsResult & { partial: boolean }> {
    return { ...findStrings(await head(file), { minLength }), partial: file.size > READ_LIMIT };
  },
};

export type ForensicsWorkerApi = typeof api;

Comlink.expose(api);
