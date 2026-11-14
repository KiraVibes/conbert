import * as Comlink from 'comlink';
import {
  blobReader,
  dangerCheck,
  findStrings,
  inspectProgram,
  recoverCroppedPng,
  type CropRecovery,
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

const api = {
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
  async strings(file: Blob, minLength: number): Promise<StringsResult & { partial: boolean }> {
    return { ...findStrings(await head(file), { minLength }), partial: file.size > READ_LIMIT };
  },
};

export type ForensicsWorkerApi = typeof api;

Comlink.expose(api);
