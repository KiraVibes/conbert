import { InfoIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface HelpTipProps {
  /** i18n key of the plain-language explanation (required). */
  helpKey: string;
  /** i18n key: what happens when the value goes up or down? */
  effectKey?: string | undefined;
  /** i18n key of the thing being explained – used as accessible label. */
  labelKey?: string | undefined;
  className?: string;
}

/**
 * The ⓘ symbol next to every option. Opens on click/tap (works on phones)
 * and shows the help text plus, if available, the effect of changing it.
 */
export function HelpTip({ helpKey, effectKey, labelKey, className }: HelpTipProps) {
  const { t } = useTranslation();
  const label = labelKey ? t(labelKey) : undefined;
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={label ? t('help.explainNamed', { name: label }) : t('help.explain')}
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          className,
        )}
      >
        <InfoIcon className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm leading-relaxed">
        {label && <p className="mb-1 font-medium">{label}</p>}
        <p>{t(helpKey)}</p>
        {effectKey && <p className="mt-2 text-muted-foreground">{t(effectKey)}</p>}
      </PopoverContent>
    </Popover>
  );
}
