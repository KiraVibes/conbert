import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, DownloadIcon, Loader2Icon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { whisperStatusSchema, type WhisperStatus } from '@conbert/schemas';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentUser } from '@/features/auth/use-auth';
import { ApiRequestError, apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';

const WHISPER_KEY = ['whisper'] as const;

/** Settings → "Speech recognition": which Whisper model, download, delete (admins). */
export function WhisperCard() {
  const { t, i18n } = useTranslation();
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const [error, setError] = useState<ApiRequestError | null>(null);
  const status = useQuery({
    queryKey: WHISPER_KEY,
    queryFn: () => apiGet('/api/whisper', whisperStatusSchema),
    enabled: me?.role === 'admin',
    // While a model downloads, show its progress.
    refetchInterval: (query) =>
      query.state.data?.models.some((m) => m.downloading !== null) ? 1000 : false,
  });
  if (me?.role !== 'admin') return null;

  const act = async (run: () => Promise<WhisperStatus | unknown>) => {
    setError(null);
    try {
      const next = await run();
      const parsed = whisperStatusSchema.safeParse(next);
      if (parsed.success) queryClient.setQueryData(WHISPER_KEY, parsed.data);
      else await queryClient.invalidateQueries({ queryKey: WHISPER_KEY });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network'));
    }
  };

  const data = status.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          {t('whisper.title')}
          <HelpTip helpKey="whisper.help" labelKey="whisper.title" />
        </CardTitle>
        <CardDescription>{t('whisper.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.isPending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            {t('whisper.loading')}
          </p>
        )}
        {data && !data.available && (
          <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            {t('whisper.unavailable')}
          </p>
        )}
        {data && (
          <fieldset className="space-y-2">
            <legend className="sr-only">{t('whisper.modelLabel')}</legend>
            {data.models.map((model) => {
              const chosen = data.defaultModel === model.id;
              const downloading = model.downloading !== null;
              const percent = downloading
                ? Math.floor(((model.downloading ?? 0) / model.bytes) * 100)
                : 0;
              return (
                <div
                  key={model.id}
                  className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center ${chosen ? 'border-primary' : ''}`}
                  data-testid="whisper-model"
                >
                  <label className="flex min-w-0 flex-1 items-start gap-2">
                    <input
                      type="radio"
                      name="whisper-model"
                      className="mt-1 size-4 accent-primary"
                      checked={chosen}
                      onChange={() =>
                        void act(() =>
                          apiPut('/api/whisper/default', { model: model.id }, whisperStatusSchema),
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{t(`whisper.models.${model.id}.name`)}</span>
                      <span className="text-sm text-muted-foreground">
                        {' '}
                        · {formatBytes(model.bytes, i18n.language)}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {t(`whisper.models.${model.id}.help`)}
                      </span>
                      <span className="block text-xs">
                        {downloading
                          ? t('whisper.downloading', { percent })
                          : model.installed
                            ? t('whisper.installed')
                            : t('whisper.notInstalled')}
                      </span>
                    </span>
                  </label>
                  <div className="flex shrink-0 gap-2">
                    {model.installed ? (
                      <>
                        <CheckIcon
                          className="size-4 self-center text-emerald-600"
                          aria-hidden="true"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void act(() => apiDelete(`/api/whisper/models/${model.id}`))
                          }
                          aria-label={t('whisper.deleteNamed', {
                            name: t(`whisper.models.${model.id}.name`),
                          })}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={downloading || !data.available}
                        onClick={() =>
                          void act(() =>
                            apiPost(
                              `/api/whisper/models/${model.id}/download`,
                              {},
                              whisperStatusSchema,
                            ),
                          )
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
                </div>
              );
            })}
          </fieldset>
        )}
        <p className="text-xs text-muted-foreground">{t('whisper.firstUse')}</p>
        {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      </CardContent>
    </Card>
  );
}
