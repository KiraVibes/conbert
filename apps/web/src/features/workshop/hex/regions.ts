import type { TFunction } from 'i18next';
import type { FileRegion, RegionKind } from '@conbert/core';
import { formatName } from '@/features/convert/format-text';
import { formatBytes } from '@/lib/format-bytes';

/** Colours per kind of region (the name is always written out too). */
export const KIND_CLASS: Record<RegionKind, string> = {
  signature: 'bg-violet-500/20 text-violet-800 dark:text-violet-200',
  header: 'bg-sky-500/15 text-sky-800 dark:text-sky-200',
  chunk: 'bg-amber-500/20 text-amber-800 dark:text-amber-200',
  data: '',
  checksum: 'bg-teal-500/15 text-teal-800 dark:text-teal-200',
  trailer: 'bg-rose-500/15 text-rose-800 dark:text-rose-200',
  appended: 'bg-orange-500/30 text-orange-900 dark:text-orange-100',
};

/** The explanation of a region with its numbers filled in. */
export function regionText(t: TFunction, region: FileRegion, language: string): string {
  const values: Record<string, string | number> = { ...region.values };
  if (typeof values['bytes'] === 'number') values['bytes'] = formatBytes(values['bytes'], language);
  if (typeof values['format'] === 'string') values['format'] = formatName(t, values['format']);
  return t(`workshop.structure.${region.key}`, values);
}
