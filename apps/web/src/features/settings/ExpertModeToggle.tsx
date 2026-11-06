import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { HelpTip } from '@/components/HelpTip';
import { useSettings } from './settings-store';

/** The expert-mode switch in the header (top right). */
export function ExpertModeToggle() {
  const { t } = useTranslation();
  const expertMode = useSettings((s) => s.expertMode);
  const setExpertMode = useSettings((s) => s.setExpertMode);
  return (
    <div className="flex items-center gap-1.5 px-2" data-tour="expert">
      <Switch id="header-expert" checked={expertMode} onCheckedChange={setExpertMode} />
      <Label htmlFor="header-expert" className="hidden text-xs sm:inline">
        {t('settings.expertMode.short')}
      </Label>
      <HelpTip
        helpKey="settings.expertMode.help"
        effectKey="settings.expertMode.effect"
        labelKey="settings.expertMode.label"
      />
    </div>
  );
}
