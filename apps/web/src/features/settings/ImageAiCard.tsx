import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, DownloadIcon, Loader2Icon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { imageAiStatusSchema } from '@conbert/schemas';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentUser } from '@/features/auth/use-auth';
import { ApiRequestError, apiDelete, apiGet, apiPost } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';

const KEY = ['image-ai'] as const;

/** Settings → "AI for pictures": the two models, download now or delete (admins). */
export function ImageAiCard() {
  const { t, i18n } = useTranslation();
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const [error, setError] = useState<ApiRequestError | null>(null);
  const status = useQuery({
    queryKey: KEY,
    queryFn: () => apiGet('/api/image-ai', imageAiStatusSchema),
    enabled: me?.role === 'admin',
    refetchInterval: (query) =>
      query.state.data?.models.some((m) => m.downloading !== null) ? 1000 : false,
  });
  if (me?.role !== 'admin') return null;

  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      const next = imageAiStatusSchema.safeParse(await run());
      if (next.success) queryClient.setQueryData(KEY, next.data);
      else await queryClient.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network'));
    }
  };

  const data = status.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          {t('imageAi.settings.title')}
          <HelpTip helpKey="imageAi.settings.help" labelKey="imageAi.settings.title" />
        </CardTitle>
        <CardDescription>{t('imageAi.settings.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.isPending && (
          <Loader2Icon className="size-4 animate-spin" aria-label={t('whisper.loading')} />
        )}
        {data && !data.available && (
          <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            {t('imageAi.settings.unavailable')}
          </p>
        )}
        {data?.models.map((model) => {
          const downloading = model.downloading !== null;
          const percent = downloading
            ? Math.floor(((model.downloading ?? 0) / model.bytes) * 100)
            : 0;
          const name = t(`imageAi.settings.models.${model.id}.name`);
          return (
            <div
              key={model.id}
              className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
              data-testid="image-ai-model"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {name}
                  <span className="text-sm font-normal text-muted-foreground">
                    {' '}
                    · {formatBytes(model.bytes, i18n.language)}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {t(`imageAi.settings.models.${model.id}.help`)}
                </p>
                <p className="text-xs">
                  {downloading
                    ? t('whisper.downloading', { percent })
                    : model.installed
                      ? t('whisper.installed')
                      : t('whisper.notInstalled')}
                </p>
              </div>
              {model.installed ? (
                <div className="flex items-center gap-2">
                  <CheckIcon className="size-4 text-emerald-600" aria-hidden="true" />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void act(() => apiDelete(`/api/image-ai/models/${model.id}`))}
                    aria-label={t('whisper.deleteNamed', { name })}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={downloading || !data.available}
                  onClick={() =>
                    void act(() => apiPost(`/api/image-ai/models/${model.id}/download`, {}))
                  }
                >
                  {downloading ? (
                    <Loader2Icon className="animate-spin" aria-hidden="true" />
                  ) : (
                    <DownloadIcon aria-hidden="true" />
                  )}
                  {t('whisper.download')}
                </Button>
              )}
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">{t('imageAi.settings.source')}</p>
        {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      </CardContent>
    </Card>
  );
}
