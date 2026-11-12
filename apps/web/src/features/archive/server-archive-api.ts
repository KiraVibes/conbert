import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { serverArchiveSchema } from '@conbert/schemas';
import { apiDelete, apiGet } from '@/lib/api';

export const SERVER_ARCHIVE_KEY = ['server-archive'] as const;

/** Downloads kept in the server archive (and how long new ones stay). */
export function useServerArchive(enabled = true) {
  return useQuery({
    queryKey: SERVER_ARCHIVE_KEY,
    queryFn: ({ signal }) => apiGet('/api/archive/files', serverArchiveSchema, { signal }),
    enabled,
  });
}

export const deleteArchived = (id: string) => apiDelete(`/api/archive/files/${id}`);
export const clearServerArchive = () => apiDelete('/api/archive/files');

/** Address of a ZIP with the given files (none = everything). */
export function archiveZipUrl(ids: readonly string[] = []): string {
  return ids.length > 0 ? `/api/archive/zip?ids=${ids.join(',')}` : '/api/archive/zip';
}

/** "7 Tage", "1 Stunde" … */
export function keepTimeText(t: TFunction, hours: number): string {
  return hours % 24 === 0
    ? t('archive.server.days', { count: hours / 24 })
    : t('archive.server.hours', { count: hours });
}
