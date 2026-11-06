import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { hex, saveBlob } from '../save-blob';
import type { BytesResult } from '../workshop-worker';

/** "foto.png" + 0x127 + zip → "foto_0x127.zip" */
export function partName(fileName: string, offset: number, format: string | null): string {
  const base = fileName.replace(/\.[^.]+$/, '') || 'datei';
  return `${base}_0x${hex(offset, 2)}.${format ?? 'bin'}`;
}

/** Hands bytes from the worker to the browser's download – or says why not. */
export function saveResult(result: BytesResult, name: string, t: TFunction): void {
  if (result.ok) saveBlob(new Blob([result.data as Uint8Array<ArrayBuffer>]), name);
  else toast.error(t(`workshop.errors.${result.code}`, { name: result.detail ?? '' }));
}
