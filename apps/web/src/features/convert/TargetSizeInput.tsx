import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpTip } from '@/components/HelpTip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type Unit = 'kb' | 'mb';
const PER_MB: Record<Unit, number> = { kb: 1024, mb: 1 };

/** Shows a size in the unit without long fractions (0.1 MB, 512 KB). */
function display(mb: number | null, unit: Unit): string {
  if (mb === null) return '';
  return String(Math.round(mb * PER_MB[unit] * 100) / 100);
}

/**
 * The desired size for "compress to a size", in KB or MB. Stores megabytes;
 * small targets start in KB so nobody has to type 0.25.
 */
export function TargetSizeInput({
  id,
  targetMb,
  disabled,
  onChange,
}: {
  id: string;
  targetMb: number | null;
  disabled?: boolean;
  onChange: (targetMb: number | null) => void;
}) {
  const { t } = useTranslation();
  const [unit, setUnit] = useState<Unit>(targetMb !== null && targetMb < 1 ? 'kb' : 'mb');
  const [text, setText] = useState(() => display(targetMb, unit));

  // A preset (e.g. "for e-mail") can set the size from outside: follow it
  // unless it's just what was typed.
  const [seen, setSeen] = useState(targetMb);
  if (seen !== targetMb) {
    setSeen(targetMb);
    const typed = Number(text.replace(',', '.')) / PER_MB[unit];
    const same = targetMb === null ? !(typed > 0) : Math.abs(typed - targetMb) < 1e-9;
    if (!same) setText(display(targetMb, unit));
  }

  const changeUnit = (next: Unit) => {
    setUnit(next);
    setText(display(targetMb, next));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{t('compress.targetSize')}</Label>
        <HelpTip helpKey="compress.targetSizeHelp" labelKey="compress.targetSize" />
      </div>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        className="h-8 w-24"
        placeholder={unit === 'mb' ? '10' : '500'}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const value = Number(e.target.value.replace(',', '.'));
          onChange(Number.isFinite(value) && value > 0 ? value / PER_MB[unit] : null);
        }}
      />
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={unit}
        onValueChange={(v) => v && changeUnit(v as Unit)}
        aria-label={t('compress.targetUnit')}
        disabled={disabled}
      >
        <ToggleGroupItem value="kb" className="px-2">
          KB
        </ToggleGroupItem>
        <ToggleGroupItem value="mb" className="px-2">
          MB
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
