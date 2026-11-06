import { useTranslation } from 'react-i18next';
import { isLanguage } from '@conbert/i18n/languages';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ViewIntro } from '@/components/ViewIntro';
import { ModeSelector } from '@/features/convert/ModeSelector';
import { AccountCard } from '@/features/auth/AccountCard';
import { UsersCard } from '@/features/auth/UsersCard';
import { WhisperCard } from './WhisperCard';
import { ImageAiCard } from './ImageAiCard';
import { ApiTokensCard } from './ApiTokensCard';
import { VaultCard } from '@/features/vault/VaultCard';
import { StorageCard } from '@/features/storage/StorageCard';
import { DownloaderSettingsCard } from '@/features/downloader/DownloaderSettingsCard';
import { BooruSettingsCard } from '@/features/booru/BooruSettingsCard';
import { NotificationsCard } from '@/features/workflows/NotificationsCard';
import { EnginesCard } from './EnginesCard';
import { OfflineCard } from './OfflineCard';
import { SettingRow } from './SettingRow';
import { useSettings, type Theme } from './settings-store';

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

export function SettingsView({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation();
  const s = useSettings();

  return (
    <div className="space-y-6">
      <ViewIntro title={t('settings.title')} help="settings">
        {t('settings.intro')}
      </ViewIntro>

      <AccountCard />
      <VaultCard />

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.appearance')}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <SettingRow
            id="setting-theme"
            label={t('settings.theme.label')}
            labelKey="settings.theme.label"
            helpKey="settings.theme.help"
          >
            <ToggleGroup
              id="setting-theme"
              type="single"
              variant="outline"
              spacing={0}
              value={s.theme}
              onValueChange={(v) => {
                if (v) s.setTheme(v as Theme);
              }}
            >
              {THEMES.map((theme) => (
                <ToggleGroupItem key={theme} value={theme} className="px-3">
                  {t(`settings.theme.${theme}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </SettingRow>

          <SettingRow
            id="setting-language"
            label={t('settings.language.label')}
            labelKey="settings.language.label"
            helpKey="settings.language.help"
          >
            <Select
              value={s.language ?? 'auto'}
              onValueChange={(v) => s.setLanguage(isLanguage(v) ? v : null)}
            >
              <SelectTrigger id="setting-language" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('settings.language.auto')}</SelectItem>
                <SelectItem value="de">Deutsch</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          <SettingRow
            id="setting-magic"
            label={t('settings.magicEffects.label')}
            labelKey="settings.magicEffects.label"
            helpKey="settings.magicEffects.help"
          >
            <Switch
              id="setting-magic"
              checked={s.magicEffects}
              onCheckedChange={s.setMagicEffects}
            />
          </SettingRow>

          <SettingRow
            id="setting-booru"
            label={t('settings.booruEnabled.label')}
            labelKey="settings.booruEnabled.label"
            helpKey="settings.booruEnabled.help"
          >
            <Switch
              id="setting-booru"
              checked={s.booruEnabled}
              onCheckedChange={s.setBooruEnabled}
            />
          </SettingRow>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.conversion')}</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          <SettingRow
            id="setting-mode"
            label={t('settings.defaultMode.label')}
            labelKey="settings.defaultMode.label"
            helpKey="settings.defaultMode.help"
          >
            <ModeSelector id="setting-mode" value={s.defaultMode} onChange={s.setDefaultMode} />
          </SettingRow>

          <SettingRow
            id="setting-expert"
            label={t('settings.expertMode.label')}
            labelKey="settings.expertMode.label"
            helpKey="settings.expertMode.help"
            effectKey="settings.expertMode.effect"
          >
            <Switch id="setting-expert" checked={s.expertMode} onCheckedChange={s.setExpertMode} />
          </SettingRow>

          {s.expertMode && (
            <SettingRow
              id="setting-threshold"
              label={t('settings.threshold.label')}
              labelKey="settings.threshold.label"
              helpKey="settings.threshold.help"
              effectKey="settings.threshold.effect"
            >
              <div className="flex items-center gap-2">
                <input
                  id="setting-threshold"
                  type="number"
                  min={1}
                  max={10000}
                  value={s.autoServerThresholdMb}
                  onChange={(e) => s.setAutoServerThresholdMb(Number(e.target.value))}
                  className="h-9 w-28 rounded-md border bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                />
                <span className="text-sm text-muted-foreground">MB</span>
              </div>
            </SettingRow>
          )}
        </CardContent>
      </Card>

      <StorageCard />
      <DownloaderSettingsCard />
      {s.booruEnabled && <BooruSettingsCard />}
      <NotificationsCard />
      <EnginesCard />
      <OfflineCard />
      <WhisperCard />
      <ImageAiCard />
      <ApiTokensCard />
      <UsersCard />
      {children}

      <Separator />
      <Button variant="outline" onClick={s.reset}>
        {t('settings.reset')}
      </Button>
    </div>
  );
}
