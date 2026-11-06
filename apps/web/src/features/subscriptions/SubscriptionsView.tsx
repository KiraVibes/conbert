import { useTranslation } from 'react-i18next';
import { DownloadIcon, ImagesIcon } from 'lucide-react';
import { ViewIntro } from '@/components/ViewIntro';
import { Button } from '@/components/ui/button';
import { SubscriptionsSection } from '@/features/booru/SubscriptionsSection';
import { useSubscriptions } from '@/features/booru/booru-api';
import { useSettings } from '@/features/settings/settings-store';
import { useView } from '@/lib/use-view';
import { FeedsSection } from './FeedsSection';

/** All subscriptions in one place: profiles, channels, threads and booru tag searches. */
export function SubscriptionsView() {
  const { t } = useTranslation();
  const [, navigate] = useView();
  const booru = useSubscriptions();
  const booruEnabled = useSettings((s) => s.booruEnabled);
  return (
    <div className="space-y-8">
      <ViewIntro title={t('feeds.overview.title')} help="subscriptions">
        {t(booruEnabled ? 'feeds.overview.intro' : 'feeds.overview.introNoBooru')}
      </ViewIntro>
      <div className="space-y-3">
        <FeedsSection showEmpty />
        <Button size="sm" variant="outline" onClick={() => navigate('download')}>
          <DownloadIcon aria-hidden="true" />
          {t('feeds.overview.addFeed')}
        </Button>
      </div>
      {booruEnabled && (
        <div className="space-y-3">
          <SubscriptionsSection titleKey="feeds.overview.booruTitle" />
          {booru.data?.length === 0 && (
            <section className="space-y-1">
              <h2 className="text-lg font-semibold">{t('feeds.overview.booruTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('feeds.overview.booruEmpty')}</p>
            </section>
          )}
          <Button size="sm" variant="outline" onClick={() => navigate('booru')}>
            <ImagesIcon aria-hidden="true" />
            {t('feeds.overview.addBooru')}
          </Button>
        </div>
      )}
    </div>
  );
}
