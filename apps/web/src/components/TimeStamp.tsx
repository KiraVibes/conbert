import { ClockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fullStamp, stamp } from '@/lib/stamp';

/** "Heruntergeladen: 12.11., 14:03" – a small line on a card, full date on hover. */
export function TimeStamp({ labelKey, iso }: { labelKey: string; iso: string }) {
  const { t, i18n } = useTranslation();
  return (
    <p className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="time-stamp">
      <ClockIcon className="size-3 shrink-0" aria-hidden="true" />
      <span>
        {t(labelKey)}{' '}
        <time dateTime={iso} title={fullStamp(iso, i18n.language)} className="tabular-nums">
          {stamp(iso, i18n.language)}
        </time>
      </span>
    </p>
  );
}
