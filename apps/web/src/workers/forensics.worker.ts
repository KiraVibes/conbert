import * as Comlink from 'comlink';
import {
  blobReader,
  cleanOffice,
  copyMove,
  dangerCheck,
  forensicFilter,
  findStrings,
  inspectProgram,
  luminance,
  readOfficeSecrets,
  recoverCroppedPng,
  type CleanOptions,
  type CopyMoveRegion,
  type ForensicFilter,
  type CropRecovery,
  type OfficeSecrets,
  type DangerReport,
  type ProgramInfo,
  type StringsResult,
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

const api = {
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
  async strings(file: Blob, minLength: number): Promise<StringsResult & { partial: boolean }> {
    return { ...findStrings(await head(file), { minLength }), partial: file.size > READ_LIMIT };
  },
};

export type ForensicsWorkerApi = typeof api;

Comlink.expose(api);
