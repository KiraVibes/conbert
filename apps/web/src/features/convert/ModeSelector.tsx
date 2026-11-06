import { CloudIcon, MonitorIcon, SparklesIcon, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ExecutionMode } from '@conbert/core';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const MODES: readonly { mode: ExecutionMode; icon: LucideIcon }[] = [
  { mode: 'local', icon: MonitorIcon },
  { mode: 'server', icon: CloudIcon },
  { mode: 'auto', icon: SparklesIcon },
];

interface ModeSelectorProps {
  value: ExecutionMode;
  onChange: (mode: ExecutionMode) => void;
  /** Hide the explanation below (e.g. on small file cards). */
  compact?: boolean;
  id?: string;
}

/** "On this device / On the server / Automatic" – always with a plain explanation. */
export function ModeSelector({ value, onChange, compact = false, id }: ModeSelectorProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <ToggleGroup
        id={id}
        type="single"
        variant="outline"
        spacing={0}
        value={value}
        onValueChange={(v) => {
          if (v) onChange(v as ExecutionMode);
        }}
        aria-label={t('mode.label')}
      >
        {MODES.map(({ mode, icon: Icon }) => (
          <ToggleGroupItem
            key={mode}
            value={mode}
            title={t(`mode.${mode}.help`)}
            className="gap-1.5 px-3"
          >
            <Icon className="size-4" aria-hidden="true" />
            {/* Icons only on narrow cards; the label stays for screen readers. */}
            <span className={compact ? 'max-sm:sr-only' : undefined}>
              {t(`mode.${mode}.label`)}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {!compact && <p className="text-sm text-muted-foreground">{t(`mode.${value}.help`)}</p>}
    </div>
  );
}
