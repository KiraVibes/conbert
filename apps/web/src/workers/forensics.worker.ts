import * as Comlink from 'comlink';
import { recoverCroppedPng, type CropRecovery } from '@conbert/core';

/**
 * Forensic checks that read a whole file or try many possibilities (e.g. a
 * cropped screenshot's lost rest) – in a worker, so the page stays usable.
 */
const api = {
  async recoverCrop(file: Blob, onProgress?: (share: number) => void): Promise<CropRecovery> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = recoverCroppedPng(bytes, onProgress);
    return result.status === 'recovered'
      ? Comlink.transfer(result, [result.pixels.buffer, result.marked.buffer])
      : result;
  },
};

export type ForensicsWorkerApi = typeof api;

Comlink.expose(api);
