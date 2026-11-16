import { CheckIcon, CloudDownloadIcon, Loader2Icon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '@/components/ErrorMessage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatBytes } from '@/lib/format-bytes';
import { useOfflineStorage } from '@/lib/use-offline-storage';

/** Settings → "Use offline": how much of the app is stored, download the rest. */
export function OfflineCard() {
  const { t, i18n } = useTranslation();
  const { status, complete, missingBytes, progress, error, prepare, clear } = useOfflineStorage();
  const size = (bytes: number | undefined) => formatBytes(bytes ?? 0, i18n.language);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.offline.title')}</CardTitle>
        <CardDescription>{t('settings.offline.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {status === undefined ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            {t('settings.offline.checking')}
          </p>
        ) : status === null || !status.available ? (
          <p className="text-muted-foreground">{t('settings.offline.unavailable')}</p>
        ) : (
          <>
            <p>
              {complete ? (
                <span className="flex items-center gap-2">
                  <CheckIcon className="size-4 text-primary" aria-hidden="true" />
                  {t('settings.offline.complete', { size: size(status.bytes) })}
                </span>
              ) : (
                t('settings.offline.partial', {
                  cached: size(status.cachedBytes),
                  total: size(status.bytes),
                })
              )}
            </p>
            {progress && (
              <div className="space-y-1" role="status">
                <Progress
                  value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
                  aria-label={t('settings.offline.preparing')}
                />
                <p className="text-muted-foreground tabular-nums">
                  {t('settings.offline.progress', {
                    done: size(progress.done),
                    total: size(progress.total),
                  })}
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {!complete && (
                <Button onClick={() => void prepare()} disabled={progress !== null}>
                  {progress ? (
                    <Loader2Icon className="animate-spin" aria-hidden="true" />
                  ) : (
                    <CloudDownloadIcon aria-hidden="true" />
                  )}
                  {t('settings.offline.prepare', { size: size(missingBytes) })}
                </Button>
              )}
              {(status.cachedBytes ?? 0) > 0 && (
                <Button variant="outline" onClick={() => void clear()} disabled={progress !== null}>
                  <Trash2Icon aria-hidden="true" />
                  {t('settings.offline.clear')}
                </Button>
              )}
            </div>
          </>
        )}
        {error && <ErrorMessage messageKey="settings.offline.error" details={error} />}
      </CardContent>
    </Card>
  );
}
