import { exiftoolSecretWrite, ffmpegCommentArgs, metaSpotFor } from '@conbert/core';
import { runFfmpeg } from '@/engines/ffmpeg-wasm';
import { writeMetadataTags } from '@/features/metadata/metadata-engine';

/** Why writing failed, for the text shown. */
export type WriteFailure = 'unsupported' | 'pdf-locked' | 'failed';

export class SecretWriteError extends Error {
  constructor(readonly code: WriteFailure) {
    super(code);
    this.name = 'SecretWriteError';
  }
}

/** PDF: the "Subject" in the document properties (ExifTool can't write PDF in the browser). */
export async function writePdfSubject(file: Blob, value: string): Promise<Blob> {
  const { PDFDocument, EncryptedPDFError } = await import('pdf-lib');
  let doc;
  try {
    doc = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  } catch (error) {
    throw new SecretWriteError(error instanceof EncryptedPDFError ? 'pdf-locked' : 'failed');
  }
  doc.setSubject(value);
  const bytes = await doc.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

/** Writes the (already sealed) message into the file's comment field. */
export async function writeSecret(file: Blob, ext: string, value: string): Promise<Blob> {
  const spot = metaSpotFor(ext);
  if (!spot) throw new SecretWriteError('unsupported');
  try {
    if (spot === 'pdf') return await writePdfSubject(file, value);
    if (spot === 'audio') {
      const args = ffmpegCommentArgs(`in.${ext}`, `out.${ext}`, value);
      return await runFfmpeg(file, `in.${ext}`, `out.${ext}`, args);
    }
    const { tags, args } = exiftoolSecretWrite(spot, value);
    return await writeMetadataTags(file, ext, tags, args);
  } catch (error) {
    if (error instanceof SecretWriteError) throw error;
    throw new SecretWriteError('failed');
  }
}
