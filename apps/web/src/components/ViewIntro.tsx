import { HelpCircleIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HelpArea } from '@conbert/core';
import { helpHref } from '@/lib/use-view';

/**
 * The short sentence at the top of every view: what can I do here?
 * `help` adds a "?" link to the matching article on the help page.
 */
export function ViewIntro({
  title,
  help,
  children,
}: {
  title?: string;
  help?: HelpArea;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const link = help && (
    <a
      href={helpHref(help)}
      className="ml-1.5 inline-flex translate-y-0.5 items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={t('helpCenter.areaLink')}
      title={t('helpCenter.areaLink')}
    >
      <HelpCircleIcon className="size-4" aria-hidden="true" />
    </a>
  );
  return (
    <div className="mb-6 space-y-1">
      {title && <h1 className="font-heading text-2xl font-semibold">{title}</h1>}
      <p className="text-muted-foreground">
        {children}
        {link}
      </p>
    </div>
  );
}
