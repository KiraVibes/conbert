import { Loader2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ErrorMessage';
import { ApiRequestError } from '@/lib/api';
import { LoginView } from './LoginView';
import { OfflineApp } from './OfflineApp';
import { SetupView } from './SetupView';
import { useAuthStatus } from './use-auth';

/** The server can't be reached at all – not "it answered with an error". */
function isUnreachable(error: ApiRequestError | null): boolean {
  return error !== null && [0, 502, 503, 504].includes(error.status);
}

/** Shows setup, login or the app – depending on who is signed in. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const status = useAuthStatus();

  if (status.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status">
        <Loader2Icon className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{t('auth.loading')}</span>
      </div>
    );
  }

  if (status.isError) {
    const error = status.error instanceof ApiRequestError ? status.error : null;
    // No connection to the server (or a proxy says it's down): converting on
    // this device still works.
    if (isUnreachable(error)) return <OfflineApp onRetry={() => void status.refetch()} />;
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
        <ErrorMessage
          className="w-full"
          messageKey={error?.messageKey ?? 'errors.network'}
          details={error?.details ?? String(status.error)}
          actions={
            <Button size="sm" variant="outline" onClick={() => void status.refetch()}>
              {t('convert.retry')}
            </Button>
          }
        />
      </div>
    );
  }

  const data = status.data;
  if (data.setupRequired) return <SetupView status={data} />;
  if (!data.user) return <LoginView status={data} />;
  return <>{children}</>;
}
