import type { TFunction } from 'i18next';
import { getFormat } from '@conbert/core';

/** "WebP-Bild (.webp)" for known formats, ".XYZ" for unknown ones. */
export function formatLabel(t: TFunction, ext: string): string {
  const info = getFormat(ext);
  return info ? `${t(info.nameKey)} (.${info.ext})` : `.${ext.toUpperCase()}`;
}

/** Short format name: "WebP-Bild", or the extension in capitals. */
export function formatName(t: TFunction, ext: string): string {
  const info = getFormat(ext);
  return info ? t(info.nameKey) : ext.toUpperCase();
}
