import { LockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Shown instead of a view the administrator blocked for this user. */
export function FeatureBlocked() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="mx-auto mt-12 flex max-w-md flex-col items-center gap-3 rounded-lg border bg-card p-8 text-center"
    >
      <LockIcon className="size-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="text-lg font-semibold">{t('permissions.blocked.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('permissions.blocked.body')}</p>
    </div>
  );
}
