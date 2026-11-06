import { MinimizeIcon, RefreshCwIcon, WandSparklesIcon, WifiOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { ConvertView } from '@/features/convert/ConvertView';
import { useView } from '@/lib/use-view';

/**
 * Shown when the server can't be reached: converting on this device still
 * works (the app and its converters come from the browser's offline storage).
 * Nothing here talks to the server or shows another account's data.
 */
export function OfflineApp({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const [view, navigate] = useView();
  const task = view === 'compress' ? 'compress' : 'convert';

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <AppHeader />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <div
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center"
        >
          <WifiOffIcon
            className="size-5 shrink-0 text-amber-700 dark:text-amber-300"
            aria-hidden="true"
          />
          <div className="flex-1 space-y-1 text-sm">
            <p className="font-medium">{t('offline.title')}</p>
            <p className="text-muted-foreground">{t('offline.body')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon aria-hidden="true" />
            {t('offline.retry')}
          </Button>
        </div>
        <nav aria-label={t('nav.label')} className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(
            [
              ['home', 'nav.convert', WandSparklesIcon],
              ['compress', 'nav.compress', MinimizeIcon],
            ] as const
          ).map(([target, label, Icon]) => {
            const active = (target === 'compress') === (task === 'compress');
            return (
              <Button
                key={target}
                variant={active ? 'secondary' : 'ghost'}
                className={active ? 'bg-background shadow-sm' : undefined}
                aria-current={active ? 'page' : undefined}
                onClick={() => navigate(target)}
              >
                <Icon aria-hidden="true" />
                {t(label)}
              </Button>
            );
          })}
        </nav>
        <ConvertView key={task} task={task} />
      </main>
    </div>
  );
}
