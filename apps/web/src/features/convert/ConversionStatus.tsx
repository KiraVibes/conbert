import { DownloadIcon, EyeIcon, RotateCcwIcon, SparklesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getFormat, targetPrecision } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ErrorMessage } from '@/components/ErrorMessage';
import { useSettings } from '@/features/settings/settings-store';
import { usePrefersReducedMotion } from '@/features/settings/use-apply-settings';
import { formatBytes } from '@/lib/format-bytes';
import { cn } from '@/lib/utils';
import { AutoSaveStatus } from '@/features/storage/AutoSaveStatus';
import { SaveToStorageButton } from '@/features/storage/StorageButtons';
import type { FileItem } from './files-store';

interface ConversionStatusProps {
  item: FileItem;
  onRetry: () => void;
  onRetryOnServer?: (() => void) | undefined;
  /** Called when the user clicks the download link. */
  onDownloaded?: () => void;
  /** Opens the preview of the result. */
  onPreview?: () => void;
}

/** Progress, result (with size comparison and download) or error of one file. */
export function ConversionStatus({
  item,
  onRetry,
  onRetryOnServer,
  onDownloaded,
  onPreview,
}: ConversionStatusProps) {
  const { t, i18n } = useTranslation();
  const magic = useSettings((s) => s.magicEffects);
  const reducedMotion = usePrefersReducedMotion();

  if (item.status === 'converting') {
    return (
      <div className="space-y-1.5" aria-live="polite">
        <Progress value={item.progress} aria-label={t('convert.progress')} />
        <p className="text-sm text-muted-foreground">
          {t(`stages.${item.stage ?? 'converting'}`)} {item.progress} %
        </p>
      </div>
    );
  }

  if (item.status === 'done' && item.result) {
    const before = item.file.size;
    const after = item.result.blob.size;
    const change = before > 0 ? Math.round(((after - before) / before) * 100) : 0;
    // Compressing to a size: the size asked for, in bytes.
    const targetBytes =
      item.task === 'compress' && item.compress.level === 'target' && item.compress.targetMb
        ? Math.round(item.compress.targetMb * 1024 * 1024)
        : null;
    return (
      <div
        className="flex flex-col gap-3 rounded-lg bg-emerald-500/10 p-3 sm:flex-row sm:items-center sm:justify-between"
        aria-live="polite"
      >
        <div className="space-y-0.5 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300">
            <SparklesIcon
              className={cn('size-4', magic && !reducedMotion && 'animate-bounce')}
              aria-hidden="true"
            />
            {t(magic ? 'convert.doneMagic' : 'convert.done')}
          </p>
          {item.result.keptOriginal ? (
            // Compressing would have made it bigger (or it already fit) – the original stays.
            <p className="text-muted-foreground">
              {t(
                targetBytes !== null && before <= targetBytes
                  ? 'compress.alreadySmall'
                  : 'compress.keptOriginal',
              )}
            </p>
          ) : item.task === 'compress' ? (
            <p className="text-muted-foreground">
              {t('compress.saved', {
                before: formatBytes(before, i18n.language),
                after: formatBytes(after, i18n.language),
                percent: -change,
              })}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {t('convert.sizeChange', {
                before: formatBytes(before, i18n.language),
                after: formatBytes(after, i18n.language),
                change: `${change > 0 ? '+' : ''}${change}`,
              })}
            </p>
          )}
          {item.task !== 'compress' && change > 0 && (
            <p className="text-muted-foreground">{t('convert.gotBigger')}</p>
          )}
          {targetBytes !== null && (
            <p
              className={
                after > targetBytes ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground'
              }
            >
              {t('compress.targetResult', {
                target: formatBytes(targetBytes, i18n.language),
                after: formatBytes(after, i18n.language),
              })}{' '}
              {after > targetBytes &&
                t(
                  targetPrecision(getFormat(item.result.ext)?.category) === 'levels'
                    ? 'compress.targetMissedLevels'
                    : 'compress.targetMissed',
                )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {onPreview && (
            <Button variant="outline" onClick={onPreview}>
              <EyeIcon aria-hidden="true" />
              {t('preview.show')}
            </Button>
          )}
          <Button asChild>
            <a href={item.result.url} download={item.result.fileName} onClick={onDownloaded}>
              <DownloadIcon aria-hidden="true" />
              {t('convert.download')}
            </a>
          </Button>
          <SaveToStorageButton
            items={[{ blob: item.result.blob, fileName: item.result.fileName }]}
            onSaved={onDownloaded}
          />
        </div>
        {item.metadataOutcome?.state === 'written' && (
          <p className="text-sm text-muted-foreground">{t('metadata.written')}</p>
        )}
        {item.metadataOutcome?.state === 'error' && (
          <ErrorMessage
            messageKey={item.metadataOutcome.error?.messageKey ?? 'errors.metadataWriteFailed'}
            details={item.metadataOutcome.error?.details}
          />
        )}
        {item.autoSave && <AutoSaveStatus autoSave={item.autoSave} />}
      </div>
    );
  }

  if (item.status === 'error' && item.error) {
    return (
      <ErrorMessage
        messageKey={item.error.messageKey}
        details={item.error.details}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCcwIcon aria-hidden="true" />
              {t('convert.retry')}
            </Button>
            {onRetryOnServer && (
              <Button size="sm" variant="outline" onClick={onRetryOnServer}>
                {t('convert.retryOnServer')}
              </Button>
            )}
          </>
        }
      />
    );
  }

  return null;
}
