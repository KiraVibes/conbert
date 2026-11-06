import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BoxIcon, CheckIcon, DownloadIcon, Loader2Icon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { blenderStatusSchema } from '@conbert/schemas';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ApiRequestError, apiDelete, apiGet, apiPost } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';

const KEY = ['blender'] as const;

/** Administration → Blender: install on demand (big download), see progress, remove. */
export function BlenderCard() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<ApiRequestError | null>(null);
  const status = useQuery({
    queryKey: KEY,
    queryFn: () => apiGet('/api/blender', blenderStatusSchema),
    refetchInterval: (query) => (query.state.data?.phase !== 'idle' ? 1000 : false),
  });
  const data = status.data;
  const busy = data !== undefined && data.phase !== 'idle';

  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      const next = blenderStatusSchema.safeParse(await run());
      if (next.success) queryClient.setQueryData(KEY, next.data);
      else await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network'));
    }
  };

  // Formats appear once the install is done: reload the engine list then.
  const [wasBusy, setWasBusy] = useState(false);
  if (busy !== wasBusy) {
    setWasBusy(busy);
    if (!busy) void queryClient.invalidateQueries({ queryKey: ['engines'] });
  }

  const size = (bytes: number) => formatBytes(bytes, i18n.language);
  const percent =
    data?.phase === 'downloading' && data.received !== null
      ? Math.floor((data.received / data.downloadBytes) * 100)
      : 0;

  return (
    <Card data-testid="blender-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <BoxIcon className="size-4" aria-hidden="true" />
          {t('blender.title')}
          <HelpTip helpKey="blender.help" labelKey="blender.title" />
        </CardTitle>
        <CardDescription>{t('blender.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.isPending && (
          <Loader2Icon className="size-4 animate-spin" aria-label={t('admin.loading')} />
        )}
        {data && !data.supported && (
          <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            {t('blender.unsupported')}
          </p>
        )}
        {data?.supported && (
          <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium">
                Blender {data.version}
                <span className="text-sm font-normal text-muted-foreground">
                  {' '}
                  ·{' '}
                  {t('blender.size', {
                    download: size(data.downloadBytes),
                    installed: size(data.installedBytes),
                  })}
                </span>
              </p>
              <p className="text-xs" aria-live="polite">
                {data.phase === 'downloading'
                  ? t('blender.downloading', { percent })
                  : data.phase === 'extracting'
                    ? t('blender.extracting')
                    : data.installed
                      ? t('blender.installed')
                      : t('blender.notInstalled')}
              </p>
              {data.phase === 'downloading' && (
                <Progress value={percent} aria-label={t('blender.downloading', { percent })} />
              )}
            </div>
            {data.installed ? (
              <div className="flex items-center gap-2">
                <CheckIcon className="size-4 text-emerald-600" aria-hidden="true" />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act(() => apiDelete('/api/blender'))}
                  aria-label={t('blender.remove')}
                  title={t('blender.remove')}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void act(() => apiPost('/api/blender/install', {}))}
              >
                {busy ? (
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                ) : (
                  <DownloadIcon aria-hidden="true" />
                )}
                {t('blender.install')}
              </Button>
            )}
          </div>
        )}
        {data?.errorKey && !busy && <ErrorMessage messageKey={data.errorKey} />}
        <p className="text-xs text-muted-foreground">{t('blender.source')}</p>
        {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      </CardContent>
    </Card>
  );
}
