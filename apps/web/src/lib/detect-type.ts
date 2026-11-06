import { fileTypeFromBlob } from 'file-type';
import { getFormat, normalizeExt, refineDetectedExt } from '@conbert/core';

export interface DetectedType {
  /** Extension we will treat the file as (canonical, lowercase). Empty if unknown. */
  ext: string;
  /** Extension found via magic bytes, if any. */
  detectedExt: string | null;
  /** Extension from the file name, if any. */
  nameExt: string | null;
  /** The name says one thing, the content another ("photo.png" that is really a JPEG). */
  mismatch: boolean;
}

function extFromName(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return normalizeExt(name.slice(dot + 1));
}

/**
 * Detects the real type of a file from its first bytes (magic bytes),
 * falling back to the file name. Never trusts the extension alone.
 */
export async function detectFileType(file: Blob & { name: string }): Promise<DetectedType> {
  const nameExt = extFromName(file.name);
  let detectedExt: string | null = null;
  try {
    const result = await fileTypeFromBlob(file);
    if (result) detectedExt = refineDetectedExt(normalizeExt(result.ext), nameExt);
  } catch {
    // Unreadable or too short – fall back to the name.
  }
  // Text-based formats (SVG, CSV, JSON …) have no magic bytes; trust the
  // name there. Only flag a mismatch when both are known formats.
  const ext = detectedExt ?? nameExt ?? '';
  const mismatch =
    detectedExt !== null &&
    nameExt !== null &&
    detectedExt !== nameExt &&
    getFormat(nameExt) !== undefined;
  return { ext, detectedExt, nameExt, mismatch };
}

/** Formats every current browser can show directly in an <img>. */
const BROWSER_IMAGE_FORMATS = new Set(['jpg', 'png', 'webp', 'gif', 'avif']);

export function canPreviewInBrowser(ext: string): boolean {
  return BROWSER_IMAGE_FORMATS.has(ext);
}
