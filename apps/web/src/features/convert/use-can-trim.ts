import { getFormat, normalizeExt } from '@conbert/core';
import { useAvailableEngines } from '@/engines/use-engines';
import type { FileItem } from './files-store';

/** Can any engine (browser or server) cut this file? */
export function useCanTrim(item: FileItem): boolean {
  const { engines } = useAvailableEngines();
  const category = getFormat(item.ext)?.category;
  if (item.task !== 'convert' || (category !== 'video' && category !== 'audio')) return false;
  const ext = normalizeExt(item.ext);
  return engines.some(
    (e) =>
      e.supportsTrim === true && e.formats.some((f) => f.canRead && normalizeExt(f.ext) === ext),
  );
}
