import { useTranslation } from 'react-i18next';
import { HelpTip } from '@/components/HelpTip';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { QUICK_ACTIONS } from './after-actions';
import { useWorkflows } from './workflows-api';

export function AfterSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const workflows = useWorkflows().data ?? [];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5">
        {t('workflows.after.label')}
        <HelpTip helpKey="workflows.after.help" labelKey="workflows.after.label" />
      </Label>
      <Select value={value || 'none'} onValueChange={(v) => onChange(v === 'none' ? '' : v)}>
        <SelectTrigger id={id} className="w-full sm:w-80">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('workflows.after.none')}</SelectItem>
          <SelectGroup>
            <SelectLabel>{t('workflows.after.quick')}</SelectLabel>
            {Object.keys(QUICK_ACTIONS).map((key) => (
              <SelectItem key={key} value={`quick:${key}`}>
                {t(`workflows.after.${key}`)}
              </SelectItem>
            ))}
          </SelectGroup>
          {workflows.length > 0 && (
            <SelectGroup>
              <SelectLabel>{t('workflows.after.saved')}</SelectLabel>
              {workflows.map((wf) => (
                <SelectItem key={wf.id} value={`wf:${wf.id}`}>
                  {wf.name}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
