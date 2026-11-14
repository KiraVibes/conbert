import { useTranslation } from 'react-i18next';
import { CheckIcon, PaletteIcon } from 'lucide-react';
import { isHexColor } from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { cn } from '@/lib/utils';
import { swatchHex } from './lyrics';

function Swatch({
  hex,
  label,
  selected,
  onClick,
  children,
}: {
  hex: string | null;
  label: string;
  selected: boolean;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      className={cn(
        'relative flex size-8 items-center justify-center rounded-full border-2 shadow-xs transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        selected ? 'border-primary ring-2 ring-primary/40' : 'border-border',
      )}
      style={hex ? { background: hex } : undefined}
    >
      {children}
      {selected && (
        <CheckIcon
          className="absolute size-4 drop-shadow"
          style={{ color: hex && parseInt(hex.slice(1), 16) > 0x999999 ? '#111' : '#fff' }}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

/**
 * Colour choice: named colours, colours from the cover (as own colours), a
 * colour picker for any colour – plus extra choices like "same as the wave".
 */
export function ColorPicker({
  id,
  option,
  value,
  onChange,
  named,
  extras = [],
  coverColors,
}: {
  id: string;
  /** Option key for texts: options.<key>.label / .help / .choices.<value>. */
  option: string;
  value: string;
  onChange: (value: string) => void;
  named: readonly string[];
  /** Choices without a colour of their own (shown as text buttons), e.g. "wave". */
  extras?: readonly string[];
  coverColors: readonly string[];
}) {
  const { t } = useTranslation();
  const choice = (v: string) => t(`options.${option}.choices.${v}`);
  const custom = isHexColor(value) && !coverColors.includes(value) ? value : null;
  return (
    <div className="space-y-2" role="group" aria-labelledby={`${id}-label`}>
      <p id={`${id}-label`} className="flex items-center gap-1 text-sm font-medium">
        {t(`options.${option}.label`)}
        <HelpTip helpKey={`options.${option}.help`} labelKey={`options.${option}.label`} />
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {named
          .filter((v) => swatchHex(v))
          .map((v) => (
            <Swatch
              key={v}
              hex={swatchHex(v)}
              label={choice(v)}
              selected={value === v}
              onClick={() => onChange(v)}
            />
          ))}
        <label
          className={cn(
            'relative flex size-8 cursor-pointer items-center justify-center rounded-full border-2 bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)] shadow-xs focus-within:ring-2 focus-within:ring-ring',
            custom ? 'border-primary ring-2 ring-primary/40' : 'border-border',
          )}
          title={t('workshop.audiovideo.customColor')}
          style={custom ? { background: custom } : undefined}
        >
          <input
            type="color"
            className="absolute inset-0 cursor-pointer opacity-0"
            value={custom ?? swatchHex(value) ?? '#a78bfa'}
            aria-label={t('workshop.audiovideo.customColorFor', {
              name: t(`options.${option}.label`),
            })}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
          />
          {custom && <CheckIcon className="size-4 text-white drop-shadow" aria-hidden="true" />}
        </label>
      </div>
      {(coverColors.length > 0 || named.includes('cover') || extras.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {coverColors.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <PaletteIcon className="size-3.5" aria-hidden="true" />
              {t('workshop.audiovideo.fromCover')}
            </span>
          )}
          {coverColors.map((hex, i) => (
            <Swatch
              key={hex}
              hex={hex}
              label={t('workshop.audiovideo.coverColorN', { n: i + 1, hex })}
              selected={value === hex}
              onClick={() => onChange(hex)}
            />
          ))}
          {[
            ...(named.includes('cover') && coverColors.length === 0 ? ['cover'] : []),
            ...extras,
          ].map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={value === v}
              onClick={() => onChange(v)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs',
                value === v ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
              )}
            >
              {choice(v)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
