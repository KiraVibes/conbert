import { CircleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface ErrorMessageProps {
  /** Base key of a three-part error text: `<key>.what`, `<key>.cause`, `<key>.action`. */
  messageKey: string;
  /** Technical details, only shown behind "Show details". */
  details?: string | undefined;
  /** Buttons for "what you can do", e.g. "Try again on the server". */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Every error has three parts: what happened, the possible cause and what
 * you can do. Technical details stay hidden unless asked for.
 */
export function ErrorMessage({ messageKey, details, actions, className }: ErrorMessageProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm',
        className,
      )}
    >
      <p className="flex items-start gap-2 font-medium text-destructive">
        <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t(`${messageKey}.what`)}
      </p>
      <dl className="mt-2 space-y-1 pl-6">
        <div>
          <dt className="inline font-medium">{t('errorParts.cause')}: </dt>
          <dd className="inline">{t(`${messageKey}.cause`)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">{t('errorParts.action')}: </dt>
          <dd className="inline">{t(`${messageKey}.action`)}</dd>
        </div>
      </dl>
      {actions && <div className="mt-3 flex flex-wrap gap-2 pl-6">{actions}</div>}
      {details && (
        <details className="mt-2 pl-6">
          <summary className="cursor-pointer text-muted-foreground">
            {t('errorParts.details')}
          </summary>
          <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
            {details}
          </pre>
        </details>
      )}
    </div>
  );
}
