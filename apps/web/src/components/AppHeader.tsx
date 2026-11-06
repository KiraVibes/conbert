import { useTranslation } from 'react-i18next';
import { Logo } from './Logo';
import { ServerStatus } from './ServerStatus';

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
        <a
          href="/"
          className="flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Logo />
          <span className="flex flex-col leading-tight">
            <span className="font-heading text-base font-semibold">{t('app.name')}</span>
            <span className="text-[11px] tracking-wide text-muted-foreground">
              {t('app.subtitle')}
            </span>
          </span>
        </a>
        <div className="ml-auto flex items-center gap-1">
          <ServerStatus />
          {children}
        </div>
      </div>
    </header>
  );
}
