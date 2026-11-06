import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLinkIcon, Loader2Icon, LogInIcon, Trash2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { PixivLoginStatus } from '@conbert/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { useSettings } from '@/features/settings/settings-store';
import { ApiRequestError } from '@/lib/api';
import {
  PIXIV_KEY,
  deletePixivLogin,
  savePixivToken,
  sendPixivCode,
  startPixivLogin,
  usePixivLogin,
} from './downloader-api';

const STEPS = [1, 2, 3, 4, 5];

/**
 * Settings → „Herunterladen“ → Pixiv: log in on Pixiv's own page, paste the
 * one-time code, the server keeps the key (encrypted, never shown again).
 */
export function PixivLoginSection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const status = usePixivLogin();
  const expert = useSettings((s) => s.expertMode);
  /** The login page address while connecting (null = not connecting). */
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const asError = (e: unknown) =>
    e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network');

  const connected = (next: PixivLoginStatus) => {
    queryClient.setQueryData(PIXIV_KEY, next);
    setLoginUrl(null);
    setCode('');
    setToken('');
    toast.success(t('downloader.pixiv.settings.success'));
  };

  const begin = async () => {
    setError(null);
    try {
      setLoginUrl((await startPixivLogin()).url);
    } catch (e) {
      setError(asError(e));
    }
  };

  const submitCode = async (value: string) => {
    if (busy || value.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      connected(await sendPixivCode(value));
    } catch (e) {
      const err = asError(e);
      setError(err);
      // Too old: a fresh login page is needed.
      if (err.code === 'PIXIV_LOGIN_EXPIRED') await begin();
    } finally {
      setBusy(false);
    }
  };

  const submitToken = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      connected(await savePixivToken(token));
    } catch (err) {
      setError(asError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await deletePixivLogin();
      await queryClient.invalidateQueries({ queryKey: PIXIV_KEY });
      toast.success(t('downloader.pixiv.settings.disconnected'));
    } catch (e) {
      setError(asError(e));
    }
  };

  const data = status.data;
  const date = data?.updatedAt ? new Date(data.updatedAt).toLocaleDateString(i18n.language) : '';

  return (
    <div className="space-y-2" data-testid="pixiv-login">
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="text-sm font-medium">{t('downloader.pixiv.settings.title')}</h3>
        <HelpTip
          helpKey="downloader.pixiv.settings.help"
          labelKey="downloader.pixiv.settings.title"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
        <span className="min-w-28 font-medium">{t('downloader.platforms.pixiv')}</span>
        <span className="flex-1 text-sm text-muted-foreground">
          {data?.connected
            ? data.name
              ? t('downloader.pixiv.settings.connectedAs', { name: data.name, date })
              : t('downloader.pixiv.settings.connected', { date })
            : t('downloader.pixiv.settings.notConnected')}
        </span>
        {loginUrl === null && (
          <Button size="sm" variant="outline" onClick={() => void begin()}>
            <LogInIcon aria-hidden="true" />
            {t(
              data?.connected
                ? 'downloader.pixiv.settings.reconnect'
                : 'downloader.pixiv.settings.connect',
            )}
          </Button>
        )}
        {data?.connected && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`${t('downloader.pixiv.settings.disconnect')}: Pixiv`}
            onClick={() => void remove()}
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        )}
      </div>

      {loginUrl !== null && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">{t('downloader.pixiv.guide.intro')}</p>
          <ol className="space-y-2">
            {STEPS.map((step) => (
              <li key={step} className="text-sm">
                <span className="mr-1 font-semibold">{step}.</span>
                {t(`downloader.pixiv.guide.step${step}`)}
              </li>
            ))}
          </ol>
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            {t('downloader.pixiv.guide.hurry')}
          </p>
          <Button size="sm" asChild>
            <a href={loginUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon aria-hidden="true" />
              {t('downloader.pixiv.settings.openLogin')}
            </a>
          </Button>
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCode(code);
            }}
          >
            <Label htmlFor="pixiv-code">{t('downloader.pixiv.settings.codeLabel')}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="pixiv-code"
                className="min-w-0 flex-1"
                autoComplete="off"
                spellCheck={false}
                placeholder={t('downloader.pixiv.settings.codePlaceholder')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                // The code lasts only 30 seconds: pasting connects right away.
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text');
                  if (pasted.includes('code=') || /^[\w-]{8,}$/.test(pasted.trim())) {
                    e.preventDefault();
                    setCode(pasted);
                    void submitCode(pasted);
                  }
                }}
              />
              <Button type="submit" disabled={busy || code.trim() === ''}>
                {busy && <Loader2Icon className="animate-spin" aria-hidden="true" />}
                {t(
                  busy
                    ? 'downloader.pixiv.settings.connecting'
                    : 'downloader.pixiv.settings.submit',
                )}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setLoginUrl(null)}>
                {t('downloader.pixiv.settings.cancel')}
              </Button>
            </div>
          </form>
        </div>
      )}

      {expert && (
        <details className="rounded-lg border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">
            {t('downloader.pixiv.settings.tokenLabel')}
          </summary>
          <form className="mt-2 space-y-2" onSubmit={(e) => void submitToken(e)}>
            <p className="text-xs text-muted-foreground">
              {t('downloader.pixiv.settings.tokenHelp')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                type="password"
                className="min-w-0 flex-1"
                autoComplete="off"
                aria-label={t('downloader.pixiv.settings.tokenLabel')}
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={busy || token.trim() === ''}>
                {t('downloader.pixiv.settings.tokenSave')}
              </Button>
            </div>
          </form>
        </details>
      )}
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
    </div>
  );
}
