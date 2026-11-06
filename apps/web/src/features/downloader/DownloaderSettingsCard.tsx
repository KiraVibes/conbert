import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpenIcon, Loader2Icon, RefreshCwIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { COOKIE_PLATFORMS } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { SettingRow } from '@/features/settings/SettingRow';
import { useSettings } from '@/features/settings/settings-store';
import { ApiRequestError } from '@/lib/api';
import {
  COOKIES_KEY,
  TOOLS_KEY,
  deleteCookies,
  saveCookies,
  updateDownloaderTools,
  useCookies,
  useDownloaderTools,
} from './downloader-api';
import { DeviantartSection } from './DeviantartSection';
import { PixivLoginSection } from './PixivLoginSection';

const SLEEP_CHOICES = [1, 2, 5, 10, 30, 60];

/** Settings → „Herunterladen“: cookies, pauses, tool updates. */
export function DownloaderSettingsCard() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const sleep = useSettings((s) => s.downloaderSleepSeconds);
  const setSleep = useSettings((s) => s.setDownloaderSleepSeconds);
  const cookies = useCookies();
  const tools = useDownloaderTools();
  const noCookies = (cookies.data?.length ?? 0) === 0;
  // Open by default until cookies are stored for some platform.
  const [guideOpen, setGuideOpen] = useState<boolean | null>(null);
  const guideShown = guideOpen ?? noCookies;
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const platformName = (p: string) => t(`downloader.platforms.${p}`);

  const upload = async (file: File | undefined) => {
    if (!file || !uploadFor) return;
    setError(null);
    try {
      await saveCookies(uploadFor, await file.text());
      await queryClient.invalidateQueries({ queryKey: COOKIES_KEY });
      toast.success(t('downloader.settings.saved', { platform: platformName(uploadFor) }));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network'));
    }
  };

  const remove = async (platform: string) => {
    await deleteCookies(platform);
    await queryClient.invalidateQueries({ queryKey: COOKIES_KEY });
    toast.success(t('downloader.settings.deleted', { platform: platformName(platform) }));
  };

  const update = async () => {
    setUpdating(true);
    setError(null);
    try {
      queryClient.setQueryData(TOOLS_KEY, await updateDownloaderTools());
      toast.success(t('downloader.settings.updated'));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network'));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('downloader.settings.title')}</CardTitle>
        <CardDescription>{t('downloader.settings.intro')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SettingRow
          id="setting-dl-sleep"
          label={t('downloader.settings.sleep')}
          labelKey="downloader.settings.sleep"
          helpKey="downloader.settings.sleepHelp"
        >
          <Select value={String(sleep)} onValueChange={(v) => setSleep(Number(v))}>
            <SelectTrigger id="setting-dl-sleep" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SLEEP_CHOICES.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {t('downloader.settings.seconds', { count: s })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-medium">{t('downloader.settings.cookies')}</h3>
            <HelpTip
              helpKey="downloader.settings.cookiesHelp"
              labelKey="downloader.settings.cookies"
            />
          </div>
          <details
            className="rounded-lg border bg-muted/30"
            open={guideShown}
            // The browser also fires "toggle" when the page opens or closes it
            // (first display, cookies added): only remember what the user did.
            onToggle={(e) => {
              if (e.currentTarget.open !== guideShown) setGuideOpen(e.currentTarget.open);
            }}
            data-testid="cookie-guide"
          >
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
              <BookOpenIcon className="size-4 text-primary" aria-hidden="true" />
              {t('downloader.guide.title')}
            </summary>
            <div className="space-y-3 px-3 pb-3">
              <p className="text-sm text-muted-foreground">{t('downloader.guide.intro')}</p>
              <ol className="space-y-3">
                {[1, 2, 3, 4, 5].map((step) => (
                  <li key={step} className="space-y-1.5">
                    <p className="text-sm">
                      <span className="mr-1 font-semibold">{step}.</span>
                      {t(`downloader.guide.step${step}`)}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="text-sm text-muted-foreground">{t('downloader.guide.platforms')}</p>
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                {t('downloader.guide.warning')}
              </p>
            </div>
          </details>
          <ul className="divide-y rounded-lg border">
            {COOKIE_PLATFORMS.map((platform) => {
              const stored = cookies.data?.find((c) => c.platform === platform);
              return (
                <li
                  key={platform}
                  className="flex flex-wrap items-center gap-2 px-3 py-2"
                  data-testid="cookie-row"
                >
                  <span className="min-w-28 font-medium">{platformName(platform)}</span>
                  <span className="flex-1 text-sm text-muted-foreground">
                    {stored
                      ? t('downloader.settings.stored', {
                          date: new Date(stored.updatedAt).toLocaleDateString(i18n.language),
                        })
                      : t('downloader.settings.none')}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`${t(stored ? 'downloader.settings.replace' : 'downloader.settings.upload')}: ${platformName(platform)}`}
                    onClick={() => {
                      setUploadFor(platform);
                      fileInput.current?.click();
                    }}
                  >
                    <UploadIcon aria-hidden="true" />
                    {t(stored ? 'downloader.settings.replace' : 'downloader.settings.upload')}
                  </Button>
                  {stored && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`${t('downloader.settings.delete')}: ${platformName(platform)}`}
                      onClick={() => void remove(platform)}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <input
            ref={fileInput}
            type="file"
            accept=".txt,text/plain"
            hidden
            data-testid="cookies-input"
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        <PixivLoginSection />

        <DeviantartSection />

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-medium">{t('downloader.settings.tools')}</h3>
            <HelpTip helpKey="downloader.settings.toolsHelp" labelKey="downloader.settings.tools" />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('downloader.settings.versions', {
              ytDlp: tools.data?.ytDlp ?? t('downloader.settings.missing'),
              galleryDl: tools.data?.galleryDl ?? t('downloader.settings.missing'),
            })}
          </p>
          {tools.data?.canUpdate ? (
            <Button size="sm" variant="outline" onClick={() => void update()} disabled={updating}>
              {updating ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCwIcon aria-hidden="true" />
              )}
              {t(updating ? 'downloader.settings.updating' : 'downloader.settings.update')}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">{t('downloader.settings.adminOnly')}</p>
          )}
        </div>
        {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
      </CardContent>
    </Card>
  );
}
