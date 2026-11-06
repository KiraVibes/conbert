import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SimilarView } from './SimilarView';
import { SwipeView } from './SwipeView';

type SwipeTab = 'swipe' | 'similar';

/**
 * The page "Swipen": sorting one card at a time, or finding look-alikes.
 * Only the open tab is mounted (the swipe keys must not act on a hidden deck).
 */
export function SwipePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SwipeTab>('swipe');
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as SwipeTab)} className="gap-4">
      <TabsList>
        <TabsTrigger value="swipe">{t('similar.tabs.swipe')}</TabsTrigger>
        <TabsTrigger value="similar">{t('similar.tabs.similar')}</TabsTrigger>
      </TabsList>
      <TabsContent value="swipe">{tab === 'swipe' && <SwipeView />}</TabsContent>
      <TabsContent value="similar">{tab === 'similar' && <SimilarView />}</TabsContent>
    </Tabs>
  );
}
