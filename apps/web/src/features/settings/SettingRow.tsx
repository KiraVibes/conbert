import { Label } from '@/components/ui/label';
import { HelpTip } from '@/components/HelpTip';

interface SettingRowProps {
  id: string;
  labelKey: string;
  helpKey: string;
  effectKey?: string;
  label: string;
  children: React.ReactNode;
}

/** One setting: label + ⓘ on the left, control on the right (stacked on phones). */
export function SettingRow({ id, labelKey, helpKey, effectKey, label, children }: SettingRowProps) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <HelpTip helpKey={helpKey} effectKey={effectKey} labelKey={labelKey} />
      </div>
      <div className="sm:max-w-md">{children}</div>
    </div>
  );
}
