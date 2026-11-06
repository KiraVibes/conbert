import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useFiles } from './files-store';

/**
 * Wait a moment before removing downloaded files: the browser must start the
 * download before the link disappears from the page.
 */
const DELAY_MS = 400;

/** Removes files from the list after their download – they stay in the archive. */
export function useRemoveAfterDownload(): (ids: string[]) => void {
  const { t } = useTranslation();
  return useCallback(
    (ids: string[]) => {
      window.setTimeout(() => {
        const { removeFile } = useFiles.getState();
        for (const id of ids) removeFile(id);
        toast(t('archive.moved', { count: ids.length }), {
          action: {
            label: t('archive.open'),
            onClick: () => {
              window.location.hash = '#/archive';
            },
          },
        });
      }, DELAY_MS);
    },
    [t],
  );
}
