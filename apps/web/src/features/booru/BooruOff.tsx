import { useTranslation } from 'react-i18next';
import { ImagesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSettings } from '@/features/settings/settings-store';

/** Shown when someone opens #/booru while the booru area is switched off. */
export function BooruOff() {
  const { t } = useTranslation();
  const setBooruEnabled = useSettings((s) => s.setBooruEnabled);
  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        <h1 className="text-xl font-semibold">{t('booru.off.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('booru.off.body')}</p>
        <Button onClick={() => setBooruEnabled(true)}>
          <ImagesIcon aria-hidden="true" />
          {t('booru.off.enable')}
        </Button>
      </CardContent>
    </Card>
  );
}
