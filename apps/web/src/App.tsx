import { lazy } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ArchiveIcon,
  ArrowLeftIcon,
  DownloadIcon,
  FileTextIcon,
  HelpCircleIcon,
  ImagesIcon,
  LayersIcon,
  MinimizeIcon,
  RssIcon,
  SparklesIcon,
  WandSparklesIcon,
  WorkflowIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AppHeader } from '@/components/AppHeader';
import { LazyView } from '@/components/LazyView';
import { AuthGate } from '@/features/auth/AuthGate';
import { UserMenu } from '@/features/auth/UserMenu';
import { useCurrentUser } from '@/features/auth/use-auth';
import { FeatureBlocked } from '@/components/FeatureBlocked';
import type { Feature } from '@conbert/schemas';
import { Tour } from '@/features/help/Tour';
import { useWorkflowResults } from '@/features/workflows/use-workflow-results';
import { useHistoryPersistence } from '@/features/archive/history-persistence';
import { useHistory } from '@/features/archive/history-store';
import { useJobLogPersistence } from '@/features/archive/job-log';
import { ConvertView } from '@/features/convert/ConvertView';
import { ExpertModeToggle } from '@/features/settings/ExpertModeToggle';
import { useSettings } from '@/features/settings/settings-store';
import { useApplySettings } from '@/features/settings/use-apply-settings';
import { useSettingsSync } from '@/features/settings/use-settings-sync';
import { loadTextPart } from '@/lib/i18n';
import { useView, type View } from '@/lib/use-view';

/** Which function a view needs (null = always there). */
const VIEW_FEATURES: Partial<Record<View, Feature[]>> = {
  home: ['convert'],
  compress: ['convert'],
  download: ['downloader'],
  booru: ['booru'],
  subscriptions: ['downloader', 'booru'],
  swipe: ['media'],
  workflows: ['workflows'],
  pdf: ['pdf'],
  workshop: ['workshop'],
};

/** true if the user may open the view (one of its functions is enough). */
function viewAllowed(view: View, permissions: readonly Feature[] | undefined): boolean {
  const needs = VIEW_FEATURES[view];
  return !needs || !permissions || needs.some((f) => permissions.includes(f));
}

// Every view but the start page is loaded when it is first opened (smaller start).
const ArchiveView = lazy(() =>
  import('@/features/archive/ArchiveView').then((m) => ({ default: m.ArchiveView })),
);
const DownloaderView = lazy(() =>
  import('@/features/downloader/DownloaderView').then((m) => ({ default: m.DownloaderView })),
);
const BooruView = lazy(() =>
  import('@/features/booru/BooruView').then((m) => ({ default: m.BooruView })),
);
const BooruOff = lazy(() =>
  import('@/features/booru/BooruOff').then((m) => ({ default: m.BooruOff })),
);
const WorkflowsView = lazy(() =>
  import('@/features/workflows/WorkflowsView').then((m) => ({ default: m.WorkflowsView })),
);
const WorkshopView = lazy(() =>
  // The workshop's texts are a separate download; the page waits for them.
  Promise.all([import('@/features/workshop/WorkshopView'), loadTextPart('workshop')]).then(
    ([m]) => ({ default: m.WorkshopView }),
  ),
);
const SubscriptionsView = lazy(() =>
  import('@/features/subscriptions/SubscriptionsView').then((m) => ({
    default: m.SubscriptionsView,
  })),
);
const SwipePage = lazy(() =>
  import('@/features/swipe/SwipePage').then((m) => ({ default: m.SwipePage })),
);
const PdfView = lazy(() => import('@/features/pdf/PdfView').then((m) => ({ default: m.PdfView })));
const AdminView = lazy(() =>
  import('@/features/admin/AdminView').then((m) => ({ default: m.AdminView })),
);
const HelpView = lazy(() =>
  import('@/features/help/HelpView').then((m) => ({ default: m.HelpView })),
);
const SettingsView = lazy(() =>
  import('@/features/settings/SettingsView').then((m) => ({ default: m.SettingsView })),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

function Shell() {
  const { t } = useTranslation();
  const [view, navigate] = useView();
  const user = useCurrentUser();
  useSettingsSync(user?.id);
  useHistoryPersistence(user?.id);
  useJobLogPersistence(user?.id);
  useWorkflowResults(user !== null && user !== undefined);
  const archived = useHistory((s) => s.entries.length);
  const booruEnabled = useSettings((s) => s.booruEnabled);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <AppHeader>
        <ExpertModeToggle />
        <Button
          variant={view === 'help' ? 'secondary' : 'ghost'}
          size="icon"
          data-tour="help"
          onClick={() => navigate('help')}
          aria-label={t('nav.help')}
          title={t('nav.help')}
        >
          <HelpCircleIcon aria-hidden="true" />
        </Button>
        {(view === 'settings' || view === 'admin' || view === 'help') && (
          <Button
            variant="ghost"
            size="icon"
            // On phones the logo already leads home and the header is full.
            className="hidden sm:inline-flex"
            onClick={() => navigate('home')}
            aria-label={t('settings.back')}
          >
            <ArrowLeftIcon aria-hidden="true" />
          </Button>
        )}
        <UserMenu
          onOpenSettings={() => navigate('settings')}
          onOpenAdmin={() => navigate('admin')}
        />
      </AppHeader>
      <main className="mx-auto max-w-5xl px-4 py-8">
        {view === 'help' ? (
          <LazyView key={view}>
            <HelpView />
          </LazyView>
        ) : view === 'settings' ? (
          <LazyView key={view}>
            <SettingsView />
          </LazyView>
        ) : view === 'admin' ? (
          <LazyView key={view}>
            <AdminView />
          </LazyView>
        ) : (
          <>
            <nav
              data-tour="nav"
              aria-label={t('nav.label')}
              className="mb-6 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 sm:flex"
            >
              {(
                [
                  ['home', 'nav.convert', WandSparklesIcon],
                  ['compress', 'nav.compress', MinimizeIcon],
                  ['download', 'nav.download', DownloadIcon],
                  ['booru', 'nav.booru', ImagesIcon],
                  ['subscriptions', 'nav.subscriptions', RssIcon],
                  ['swipe', 'nav.swipe', LayersIcon],
                  ['workflows', 'nav.workflows', WorkflowIcon],
                  ['pdf', 'nav.pdf', FileTextIcon],
                  ['workshop', 'nav.workshop', SparklesIcon],
                  ['archive', 'nav.archive', ArchiveIcon],
                ] as const
              )
                .filter(([target]) => target !== 'booru' || booruEnabled)
                .filter(([target]) => viewAllowed(target, user?.permissions))
                .map(([target, label, Icon]) => (
                  // Phones show icon + label in a grid; wider screens only the
                  // icon, with the label as tooltip (and for screen readers).
                  <Tooltip key={target}>
                    <TooltipTrigger asChild>
                      <Button
                        variant={view === target ? 'secondary' : 'ghost'}
                        className={
                          'relative min-w-0 flex-1 gap-1.5 px-2 max-sm:h-auto max-sm:flex-col max-sm:gap-0.5 max-sm:px-1 max-sm:py-1.5 max-sm:text-xs' +
                          (view === target ? ' bg-background shadow-sm' : '')
                        }
                        aria-current={view === target ? 'page' : undefined}
                        onClick={() => navigate(target)}
                      >
                        <Icon aria-hidden="true" />
                        <span className="sm:sr-only">{t(label)}</span>
                        {target === 'archive' && archived > 0 && (
                          <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums sm:absolute sm:top-0.5 sm:right-1 sm:px-1 sm:text-[10px]">
                            {archived}
                          </span>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-sm:hidden">
                      {t(label)}
                    </TooltipContent>
                  </Tooltip>
                ))}
            </nav>
            <LazyView key={view}>
              {!viewAllowed(view, user?.permissions) ? (
                <FeatureBlocked />
              ) : view === 'archive' ? (
                <ArchiveView />
              ) : view === 'download' ? (
                <DownloaderView />
              ) : view === 'booru' ? (
                booruEnabled ? (
                  <BooruView />
                ) : (
                  <BooruOff />
                )
              ) : view === 'workflows' ? (
                <WorkflowsView />
              ) : view === 'workshop' ? (
                <WorkshopView />
              ) : view === 'subscriptions' ? (
                <SubscriptionsView />
              ) : view === 'swipe' ? (
                <SwipePage />
              ) : view === 'pdf' ? (
                <PdfView />
              ) : (
                <ConvertView key={view} task={view === 'compress' ? 'compress' : 'convert'} />
              )}
            </LazyView>
          </>
        )}
      </main>
      <Tour />
    </div>
  );
}

/** Theme and language apply on every page, including setup and login. */
function Root() {
  const theme = useSettings((s) => s.theme);
  useApplySettings();
  return (
    <>
      <AuthGate>
        <Shell />
      </AuthGate>
      <Toaster theme={theme} position="bottom-right" />
    </>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <Root />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
