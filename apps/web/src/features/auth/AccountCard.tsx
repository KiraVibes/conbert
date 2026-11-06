import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PASSWORD_MIN_LENGTH } from '@conbert/schemas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StorageUsage } from './StorageUsage';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ApiRequestError } from '@/lib/api';
import { PasswordField } from './FormField';
import { useChangePassword, useCurrentUser } from './use-auth';

/** Your own account: who you are and changing your password. */
export function AccountCard() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const change = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  if (!user) return null;

  const tooShort = next.length > 0 && next.length < PASSWORD_MIN_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== next;
  const valid = current.length > 0 && next.length >= PASSWORD_MIN_LENGTH && next === repeat;
  const error = change.error instanceof ApiRequestError ? change.error : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('auth.account.title')}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          {t('auth.account.signedInAs', { name: user.username })}
          <Badge variant="secondary">{t(`auth.roles.${user.role}`)}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <StorageUsage />
        {user.hasPassword ? (
          <form
            className="max-w-sm space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!valid) return;
              change.mutate(
                { currentPassword: current, newPassword: next },
                {
                  onSuccess: () => {
                    setCurrent('');
                    setNext('');
                    setRepeat('');
                    toast.success(t('auth.account.passwordChanged'));
                  },
                },
              );
            }}
          >
            <p className="text-sm font-medium">{t('auth.account.changePassword')}</p>
            <PasswordField
              id="pw-current"
              label={t('auth.account.currentPassword')}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
            <PasswordField
              id="pw-new"
              label={t('auth.account.newPassword')}
              hint={t('auth.passwordHint', { min: PASSWORD_MIN_LENGTH })}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              error={
                tooShort ? t('auth.passwordTooShort', { min: PASSWORD_MIN_LENGTH }) : undefined
              }
            />
            <PasswordField
              id="pw-repeat"
              label={t('auth.passwordRepeat')}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              autoComplete="new-password"
              error={mismatch ? t('auth.passwordMismatch') : undefined}
            />
            {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
            <Button type="submit" disabled={!valid || change.isPending}>
              {t('auth.account.savePassword')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('auth.account.otherDevices')}</p>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">{t('auth.account.proxyUser')}</p>
        )}
      </CardContent>
    </Card>
  );
}
