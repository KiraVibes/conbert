import { useQuery } from '@tanstack/react-query';
import { EyeIcon, Loader2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getFormat, normalizeExt } from '@conbert/core';
import { ErrorMessage } from '@/components/ErrorMessage';
import { PreviewBody } from '@/features/preview/PreviewDialog';
import type { PreviewSource } from '@/features/preview/preview-source';
import { ApiRequestError } from '@/lib/api';
import { fetchTargetFile } from './storage-api';

/**
 * Preview of the file clicked last while choosing what to open from a
 * storage location. Uses the same renderers as the normal preview.
 */
export function StoragePreview({ targetId, path }: { targetId: string; path: string | null }) {
  const { t } = useTranslation();
  const name = path?.split('/').pop() ?? '';
  const ext = normalizeExt(name);
  const query = useQuery({
    queryKey: ['storage-preview', targetId, path],
    enabled: path !== null,
    queryFn: async ({ signal }): Promise<PreviewSource> => ({
      key: `storage:${targetId}:${path}`,
      blob: await fetchTargetFile(targetId, path ?? '', signal),
      ext,
      name,
    }),
    retry: false,
    staleTime: 60_000,
  });

  if (path === null) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        <EyeIcon className="size-6" aria-hidden="true" />
        {t('storage.open.previewHint')}
      </div>
    );
  }
  return (
    <section
      aria-label={t('storage.open.previewOf', { name })}
      className="min-w-0 space-y-2"
      data-testid="storage-preview"
    >
      <p className="truncate text-sm font-medium" title={name}>
        {name}
        {getFormat(ext) && (
          <span className="ml-2 font-normal text-muted-foreground">
            {t(getFormat(ext)?.nameKey ?? '')}
          </span>
        )}
      </p>
      {query.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          {t('storage.open.previewLoading')}
        </p>
      )}
      {query.error && (
        <ErrorMessage
          messageKey={
            query.error instanceof ApiRequestError ? query.error.messageKey : 'errors.network'
          }
          details={query.error instanceof ApiRequestError ? query.error.details : undefined}
        />
      )}
      {query.data && (
        <div className="max-h-[55vh] min-w-0 overflow-auto">
          <PreviewBody source={query.data} />
        </div>
      )}
    </section>
  );
}
