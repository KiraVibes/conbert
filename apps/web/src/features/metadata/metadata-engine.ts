import * as Comlink from 'comlink';
import {
  ConversionError,
  exiftoolWrite,
  ffmpegMetadataArgs,
  getFormat,
  metadataWriter,
  pdfInfoEdits,
  type MetadataEdits,
  type MetadataTags,
} from '@conbert/core';
import { runFfmpeg } from '@/engines/ffmpeg-wasm';
import type { ExiftoolWorkerApi } from '@/workers/exiftool.worker';

let worker: Worker | null = null;
let api: Comlink.Remote<ExiftoolWorkerApi> | null = null;

function connect(): Comlink.Remote<ExiftoolWorkerApi> {
  if (!api) {
    worker = new Worker(new URL('../../workers/exiftool.worker.ts', import.meta.url), {
      type: 'module',
      name: 'exiftool',
    });
    api = Comlink.wrap<ExiftoolWorkerApi>(worker);
  }
  return api;
}

/** After a failure ExifTool's interpreter can't be reused – start a fresh worker next time. */
function restart(): void {
  worker?.terminate();
  worker = null;
  api = null;
}

/** Calls are queued: one ExifTool run at a time. */
let queue: Promise<unknown> = Promise.resolve();

function run<T>(task: (remote: Comlink.Remote<ExiftoolWorkerApi>) => Promise<T>, errorKey: string) {
  const next = queue.then(async () => {
    try {
      return await task(connect());
    } catch (error) {
      restart();
      throw new ConversionError(errorKey, error instanceof Error ? error.message : String(error));
    }
  });
  queue = next.catch(() => undefined);
  return next;
}

/** All metadata of a file, read on this device. */
export function readMetadata(blob: Blob, ext: string): Promise<MetadataTags> {
  return run((remote) => remote.read(blob, ext), 'errors.metadataReadFailed');
}

/** PDF document properties with pdf-lib (ExifTool can't write PDFs in the browser). */
async function writePdfMetadata(blob: Blob, edits: MetadataEdits): Promise<Blob> {
  const { PDFDocument, PDFDict, PDFName, PDFString, EncryptedPDFError } = await import('pdf-lib');
  let doc;
  try {
    // updateMetadata: false – pdf-lib would otherwise sign itself in as "Producer".
    doc = await PDFDocument.load(await blob.arrayBuffer(), { updateMetadata: false });
  } catch (error) {
    throw new ConversionError(
      error instanceof EncryptedPDFError ? 'errors.encrypted' : 'errors.metadataWriteFailed',
      error instanceof Error ? error.message : String(error),
    );
  }
  const change = pdfInfoEdits(edits);
  const { context } = doc;
  const existing = context.trailerInfo.Info
    ? context.lookupMaybe(context.trailerInfo.Info, PDFDict)
    : undefined;
  const info = change.clear || !existing ? context.obj({}) : existing;
  if (change.clear || !existing) context.trailerInfo.Info = context.register(info);
  // The XMP packet repeats title and author; programs prefer it, so old
  // values there would win over the new ones – it goes when anything changes.
  doc.catalog.delete(PDFName.of('Metadata'));
  for (const [key, value] of Object.entries(change.entries)) {
    if (value === null) info.delete(PDFName.of(key));
    else info.set(PDFName.of(key), PDFString.of(value));
  }
  if (change.created === null) info.delete(PDFName.of('CreationDate'));
  else if (change.created) doc.setCreationDate(change.created);
  const bytes = await doc.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

/** The file with the edits written into it (on this device). */
export async function writeMetadataEdits(
  blob: Blob,
  ext: string,
  edits: MetadataEdits,
): Promise<Blob> {
  const writer = metadataWriter(ext);
  if (writer === 'pdf') return writePdfMetadata(blob, edits);
  if (writer === 'ffmpeg') {
    try {
      return await runFfmpeg(
        blob,
        `in.${ext}`,
        `out.${ext}`,
        ffmpegMetadataArgs(`in.${ext}`, `out.${ext}`, ext, edits),
      );
    } catch (error) {
      throw new ConversionError(
        'errors.metadataWriteFailed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const { tags, args } = exiftoolWrite(ext, edits);
  const bytes = await run(
    (remote) => remote.write(blob, ext, tags, args),
    'errors.metadataWriteFailed',
  );
  return new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: blob.type || getFormat(ext)?.mime || 'application/octet-stream',
  });
}

/** The file with exactly these ExifTool tags written (for workshop tricks). */
export async function writeMetadataTags(
  blob: Blob,
  ext: string,
  tags: Record<string, string>,
  args: string[],
): Promise<Blob> {
  const bytes = await run(
    (remote) => remote.write(blob, ext, tags, args),
    'errors.metadataWriteFailed',
  );
  return new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: blob.type || getFormat(ext)?.mime || 'application/octet-stream',
  });
}
