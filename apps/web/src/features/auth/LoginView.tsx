import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthStatusResponse } from '@conbert/schemas';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ApiRequestError } from '@/lib/api';
import { AuthLayout } from './AuthLayout';
import { FormField, PasswordField } from './FormField';
import { useLogin } from './use-auth';

export function LoginView({ status }: { status: AuthStatusResponse }) {
  const { t } = useTranslation();
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (status.authMode === 'proxy') {
    // The reverse proxy should have told us who this is – it didn't.
    return (
      <AuthLayout title={t('auth.login.title')} description={t('auth.login.proxyIntro')}>
        <div className="space-y-4">
          <ErrorMessage messageKey="errors.proxyLoginMissing" />
          <Button className="w-full" onClick={() => window.location.reload()}>
            {t('auth.reload')}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  const error = login.error instanceof ApiRequestError ? login.error : null;

  return (
    <AuthLayout
      title={t('auth.login.title')}
      description={t(status.ldap ? 'auth.login.introLdap' : 'auth.login.intro')}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (username && password) login.mutate({ username, password });
        }}
      >
        <FormField
          id="login-username"
          label={t('auth.username')}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoFocus
          required
        />
        <PasswordField
          id="login-password"
          label={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
        <Button
          type="submit"
          className="w-full"
          disabled={login.isPending || !username || !password}
        >
          {login.isPending ? t('auth.working') : t('auth.login.submit')}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t('auth.login.forgot')}</p>
      </form>
    </AuthLayout>
  );
}
