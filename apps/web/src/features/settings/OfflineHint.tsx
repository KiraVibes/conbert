import { useState } from 'react';
import { CheckIcon, CloudDownloadIcon, Loader2Icon, WifiOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '@/components/ErrorMessage';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatBytes } from '@/lib/format-bytes';
import { isInstalledApp, useOfflineStorage } from '@/lib/use-offline-storage';

const DISMISSED_KEY = 'conbert.offlineHintDismissed';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Start page of the installed app: offers to store everything for offline use
 * once. Without that, only tools used before work without a connection – and
 * offline it's too late to download the rest.
 */
export function OfflineHint() {
  const [installed] = useState(isInstalledApp);
  const [dismissed, setDismissed] = useState(wasDismissed);
  if (!installed || dismissed) return null;
  return <OfflineHintCard onDismiss={() => setDismissed(true)} />;
}

function OfflineHintCard({ onDismiss }: { onDismiss: () => void }) {
  const { t, i18n } = useTranslation();
  const { status, complete, missingBytes, progress, error, prepare } = useOfflineStorage();
  const [justFinished, setJustFinished] = useState(false);
  const size = (bytes: number) => formatBytes(bytes, i18n.language);

  if (!status?.available || (complete && !justFinished)) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode: the hint simply comes back next time.
    }
    onDismiss();
  };

  const start = async () => {
    await prepare();
    setJustFinished(true);
  };

  return (
    <section
      aria-labelledby="offline-hint-title"
      className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm"
    >
      <div className="flex items-start gap-3">
        <WifiOffIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="space-y-1">
          <h2 id="offline-hint-title" className="font-medium">
            {t('settings.offline.hint.title')}
          </h2>
          <p className="text-muted-foreground">
            {complete
              ? t('settings.offline.complete', { size: size(status.bytes ?? 0) })
              : t('settings.offline.hint.body', { size: size(missingBytes) })}
          </p>
        </div>
      </div>
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
      {error && <ErrorMessage messageKey="settings.offline.error" details={error} />}
      <div className="flex flex-wrap gap-2">
        {complete ? (
          <Button variant="outline" onClick={dismiss}>
            <CheckIcon aria-hidden="true" />
            {t('settings.offline.hint.close')}
          </Button>
        ) : (
          <>
            <Button onClick={() => void start()} disabled={progress !== null}>
              {progress ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : (
                <CloudDownloadIcon aria-hidden="true" />
              )}
              {t('settings.offline.prepare', { size: size(missingBytes) })}
            </Button>
            <Button variant="ghost" onClick={dismiss} disabled={progress !== null}>
              {t('settings.offline.hint.later')}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
