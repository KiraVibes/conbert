import { CheckCircle2Icon, Loader2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '@/components/ErrorMessage';
import type { AutoSaveState } from '@/features/convert/files-store';
import { useTargets } from './storage-api';

/** One line on the result card: "Automatically saved to NAS (Ablage/Bild.webp)". */
export function AutoSaveStatus({ autoSave }: { autoSave: AutoSaveState }) {
  const { t } = useTranslation();
  const targets = useTargets();
  const name =
    targets.data?.find((target) => target.id === autoSave.targetId)?.name ??
    t('storage.autoSave.unknownTarget');

  if (autoSave.state === 'error') {
    return (
      <ErrorMessage
        messageKey={autoSave.error?.messageKey ?? 'errors.storageFailed'}
        details={[t('storage.autoSave.failed', { name }), autoSave.error?.details]
          .filter(Boolean)
          .join('\n')}
      />
    );
  }
  return (
    <p role="status" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      {autoSave.state === 'saving' ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <CheckCircle2Icon
          className="size-4 shrink-0 text-green-700 dark:text-green-400"
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 truncate" title={autoSave.path}>
        {t(`storage.autoSave.${autoSave.state}`, { name, path: autoSave.path ?? '' })}
      </span>
    </p>
  );
}
