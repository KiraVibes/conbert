import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PASSWORD_MIN_LENGTH, type AuthStatusResponse } from '@conbert/schemas';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ApiRequestError } from '@/lib/api';
import { AuthLayout } from './AuthLayout';
import { FormField, PasswordField } from './FormField';
import { useSetup } from './use-auth';

type Mode = 'local' | 'proxy';

/** First start: create the administrator account (or use reverse-proxy login). */
export function SetupView({ status }: { status: AuthStatusResponse }) {
  const { t } = useTranslation();
  const setup = useSetup();
  const proxyPossible = status.proxyAvailable && status.proxyUser !== null;
  const [mode, setMode] = useState<Mode>(proxyPossible ? 'proxy' : 'local');
  const [setupCode, setSetupCode] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [touched, setTouched] = useState(false);

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== password;
  const localValid =
    username.trim().length >= 2 && password.length >= PASSWORD_MIN_LENGTH && repeat === password;
  const valid = setupCode.trim().length > 0 && (mode === 'proxy' || localValid);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    setup.mutate(
      mode === 'proxy'
        ? { mode: 'proxy', setupCode }
        : {
            mode: 'local',
            setupCode,
            username,
            password,
            ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
          },
    );
  };

  const error = setup.error instanceof ApiRequestError ? setup.error : null;

  return (
    <AuthLayout title={t('auth.setup.title')} description={t('auth.setup.intro')}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <FormField
          id="setup-code"
          label={t('auth.setup.code')}
          hint={t('auth.setup.codeHint')}
          helpKey="auth.setup.codeHelp"
          value={setupCode}
          onChange={(e) => setSetupCode(e.target.value)}
          autoComplete="one-time-code"
          autoFocus
          required
          error={touched && !setupCode.trim() ? t('auth.required') : undefined}
        />

        {status.proxyAvailable && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('auth.setup.modeLabel')}</p>
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={0}
              value={mode}
              onValueChange={(v) => v && setMode(v as Mode)}
            >
              <ToggleGroupItem value="local">{t('auth.setup.modeLocal')}</ToggleGroupItem>
              <ToggleGroupItem value="proxy" disabled={!proxyPossible}>
                {t('auth.setup.modeProxy')}
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-sm text-muted-foreground">
              {mode === 'proxy'
                ? t('auth.setup.modeProxyHelp', { user: status.proxyUser ?? '' })
                : proxyPossible
                  ? t('auth.setup.modeLocalHelp')
                  : t('auth.setup.proxyNotDetected')}
            </p>
          </div>
        )}

        {mode === 'local' && (
          <div className="space-y-4">
            <FormField
              id="setup-username"
              label={t('auth.username')}
              hint={t('auth.usernameHint')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              required
              error={touched && username.trim().length < 2 ? t('auth.required') : undefined}
            />
            <FormField
              id="setup-display-name"
              label={t('auth.displayName')}
              hint={t('auth.displayNameHint')}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
            <PasswordField
              id="setup-password"
              label={t('auth.password')}
              hint={t('auth.passwordHint', { min: PASSWORD_MIN_LENGTH })}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              error={
                tooShort ? t('auth.passwordTooShort', { min: PASSWORD_MIN_LENGTH }) : undefined
              }
            />
            <PasswordField
              id="setup-repeat"
              label={t('auth.passwordRepeat')}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              autoComplete="new-password"
              required
              error={mismatch ? t('auth.passwordMismatch') : undefined}
            />
          </div>
        )}

        {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}

        <Button type="submit" className="w-full" disabled={setup.isPending}>
          {setup.isPending ? t('auth.working') : t('auth.setup.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
