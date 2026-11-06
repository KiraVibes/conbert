import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ExternalLinkIcon,
  KeyRoundIcon,
  Loader2Icon,
  LogInIcon,
  LogOutIcon,
  Trash2Icon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { DeviantartStatus } from '@conbert/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { CopyButton } from '@/features/workshop/CopyButton';
import { ApiRequestError } from '@/lib/api';
import {
  DEVIANTART_KEY,
  deleteDeviantart,
  saveDeviantartApp,
  sendDeviantartCode,
  startDeviantartLogin,
  useDeviantart,
} from './downloader-api';

/** Must match the "OAuth2 Redirect URI Whitelist" of the app (gallery-dl's redirect page). */
const REDIRECT_URI = 'https://mikf.github.io/gallery-dl/oauth-redirect.html';
const DEVELOPER_PAGE = 'https://www.deviantart.com/developers/apps';
const APP_STEPS = [1, 2, 3, 4, 5];
const LOGIN_STEPS = [1, 2, 3, 4];

/**
 * Settings → „Herunterladen“ → DeviantArt: your own API app (gallery-dl's
 * built-in one is shared by everyone and often busy), then optionally a
 * login on DeviantArt's own page for mature and private works.
 */
export function DeviantartSection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const status = useDeviantart();
  const [setup, setSetup] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  /** The login page address while logging in (null = not logging in). */
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const asError = (e: unknown) =>
    e instanceof ApiRequestError ? e : new ApiRequestError(0, 'errors.network');
  const update = (next: DeviantartStatus) => queryClient.setQueryData(DEVIANTART_KEY, next);

  const saveApp = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      update(await saveDeviantartApp(clientId, clientSecret));
      setSetup(false);
      setClientId('');
      setClientSecret('');
      toast.success(t('downloader.deviantart.settings.appSaved'));
    } catch (err) {
      setError(asError(err));
    } finally {
      setBusy(false);
    }
  };

  const begin = async () => {
    setError(null);
    try {
      setLoginUrl((await startDeviantartLogin()).url);
    } catch (e) {
      setError(asError(e));
    }
  };

  const submitCode = async (value: string) => {
    if (busy || value.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      update(await sendDeviantartCode(value));
      setLoginUrl(null);
      setCode('');
      toast.success(t('downloader.deviantart.settings.success'));
    } catch (e) {
      const err = asError(e);
      setError(err);
      // Too old: a fresh login page is needed.
      if (err.code === 'DEVIANTART_LOGIN_EXPIRED') await begin();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (everything: boolean) => {
    setError(null);
    try {
      await deleteDeviantart(everything);
      await queryClient.invalidateQueries({ queryKey: DEVIANTART_KEY });
      setLoginUrl(null);
      toast.success(
        t(
          everything
            ? 'downloader.deviantart.settings.removed'
            : 'downloader.deviantart.settings.loggedOut',
        ),
      );
    } catch (e) {
      setError(asError(e));
    }
  };

  const data = status.data;
  const date = data?.updatedAt ? new Date(data.updatedAt).toLocaleDateString(i18n.language) : '';
  const state = !data?.hasApp
    ? t('downloader.deviantart.settings.shared')
    : data.connected
      ? data.name
        ? t('downloader.deviantart.settings.connectedAs', { name: data.name, date })
        : t('downloader.deviantart.settings.connected', { date })
      : t('downloader.deviantart.settings.ownApp', { id: data.clientId ?? '' });

  return (
    <div className="space-y-2" data-testid="deviantart-login">
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="text-sm font-medium">{t('downloader.deviantart.settings.title')}</h3>
        <HelpTip
          helpKey="downloader.deviantart.settings.help"
          labelKey="downloader.deviantart.settings.title"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
        <span className="min-w-28 font-medium">{t('downloader.platforms.deviantart')}</span>
        <span className="flex-1 text-sm text-muted-foreground">{state}</span>
        {!setup && (
          <Button size="sm" variant="outline" onClick={() => setSetup(true)}>
            <KeyRoundIcon aria-hidden="true" />
            {t(
              data?.hasApp
                ? 'downloader.deviantart.settings.changeApp'
                : 'downloader.deviantart.settings.setupApp',
            )}
          </Button>
        )}
        {data?.hasApp && loginUrl === null && (
          <Button size="sm" variant="outline" onClick={() => void begin()}>
            <LogInIcon aria-hidden="true" />
            {t(
              data.connected
                ? 'downloader.deviantart.settings.reconnect'
                : 'downloader.deviantart.settings.connect',
            )}
          </Button>
        )}
        {data?.connected && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('downloader.deviantart.settings.logout')}
            title={t('downloader.deviantart.settings.logout')}
            onClick={() => void remove(false)}
          >
            <LogOutIcon aria-hidden="true" />
          </Button>
        )}
        {data?.hasApp && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('downloader.deviantart.settings.remove')}
            title={t('downloader.deviantart.settings.remove')}
            onClick={() => void remove(true)}
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        )}
      </div>

      {setup && (
        <form
          className="space-y-3 rounded-lg border bg-muted/30 p-3"
          onSubmit={(e) => void saveApp(e)}
        >
          <p className="text-sm text-muted-foreground">
            {t('downloader.deviantart.appGuide.intro')}
          </p>
          <ol className="space-y-2">
            {APP_STEPS.map((step) => (
              <li key={step} className="space-y-1.5 text-sm">
                <p>
                  <span className="mr-1 font-semibold">{step}.</span>
                  {t(`downloader.deviantart.appGuide.step${step}`)}
                </p>
                {step === 1 && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={DEVELOPER_PAGE} target="_blank" rel="noopener noreferrer">
                      <ExternalLinkIcon aria-hidden="true" />
                      {t('downloader.deviantart.appGuide.openDevelopers')}
                    </a>
                  </Button>
                )}
                {step === 3 && (
                  <div className="flex items-center gap-1">
                    <Input
                      readOnly
                      className="min-w-0 flex-1 font-mono text-xs"
                      aria-label={t('downloader.deviantart.appGuide.redirectLabel')}
                      value={REDIRECT_URI}
                      onFocus={(e) => e.target.select()}
                    />
                    <CopyButton
                      text={REDIRECT_URI}
                      label={t('downloader.deviantart.appGuide.copy')}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="deviantart-client-id">
                {t('downloader.deviantart.settings.clientId')}
              </Label>
              <Input
                id="deviantart-client-id"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                placeholder="12345"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="deviantart-client-secret">
                {t('downloader.deviantart.settings.clientSecret')}
              </Label>
              <Input
                id="deviantart-client-secret"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={busy || clientId.trim() === '' || clientSecret.trim() === ''}
            >
              {busy && <Loader2Icon className="animate-spin" aria-hidden="true" />}
              {t(
                busy
                  ? 'downloader.deviantart.settings.checking'
                  : 'downloader.deviantart.settings.saveApp',
              )}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSetup(false)}>
              {t('downloader.deviantart.settings.cancel')}
            </Button>
          </div>
        </form>
      )}

      {loginUrl !== null && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">
            {t('downloader.deviantart.loginGuide.intro')}
          </p>
          <ol className="space-y-2">
            {LOGIN_STEPS.map((step) => (
              <li key={step} className="text-sm">
                <span className="mr-1 font-semibold">{step}.</span>
                {t(`downloader.deviantart.loginGuide.step${step}`)}
              </li>
            ))}
          </ol>
          <Button size="sm" asChild>
            <a href={loginUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon aria-hidden="true" />
              {t('downloader.deviantart.settings.openLogin')}
            </a>
          </Button>
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void submitCode(code);
            }}
          >
            <Label htmlFor="deviantart-code">{t('downloader.deviantart.settings.codeLabel')}</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="deviantart-code"
                className="min-w-0 flex-1"
                autoComplete="off"
                spellCheck={false}
                placeholder="http://localhost:6414/?code=…"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                // Pasting the address connects right away.
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData('text');
                  if (pasted.includes('code=')) {
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
                    ? 'downloader.deviantart.settings.connecting'
                    : 'downloader.deviantart.settings.submit',
                )}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setLoginUrl(null)}>
                {t('downloader.deviantart.settings.cancel')}
              </Button>
            </div>
          </form>
        </div>
      )}
      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
    </div>
  );
}

/** Under a checked DeviantArt link: what the current setup means for this download. */
export function DeviantartProbeHint() {
  const { t } = useTranslation();
  const data = useDeviantart().data;
  if (!data || data.connected) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {t(data.hasApp ? 'downloader.deviantartOwnHint' : 'downloader.deviantartHint')}
      <a href="#/settings" className="font-medium underline">
        {t('downloader.toSettings')}
      </a>
    </p>
  );
}
