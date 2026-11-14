import { useRef } from 'react';
import { FileIcon, XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { lockedOptions, optionsFor, type EngineOption } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { HelpTip } from '@/components/HelpTip';
import { useSettings } from '@/features/settings/settings-store';
import { choiceFontStyle, useChoiceFonts } from '@/lib/choice-font';

interface OptionsPanelProps {
  idPrefix: string;
  options: readonly EngineOption[];
  outputExt: string;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}

/**
 * Engine options for one target format. Simple mode shows only the basic
 * ones (usually just quality); expert mode shows everything. Every option
 * has its ⓘ explanation.
 */
export function OptionsPanel(props: OptionsPanelProps) {
  const { idPrefix, options, outputExt, values, onChange, disabled } = props;
  const { t } = useTranslation();
  const expertMode = useSettings((s) => s.expertMode);
  const visible = optionsFor(options, outputExt).filter((o) => expertMode || !o.advanced);
  if (visible.length === 0) return null;
  // Options another option fixes right now (e.g. quality while lossless is on).
  const locked = lockedOptions(options, values);

  return (
    <div className="grid gap-4 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
      {visible.map((option) => {
        const id = `${idPrefix}-${option.key}`;
        const lock = locked.get(option.key);
        const value = lock ? lock.value : (values[option.key] ?? option.default);
        const by = lock && options.find((o) => o.key === lock.by);
        return (
          <div key={option.key} className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor={id}>{t(option.labelKey)}</Label>
              <HelpTip
                helpKey={option.helpKey}
                effectKey={option.effectKey}
                labelKey={option.labelKey}
              />
              {option.type === 'number' && (
                <span className="ml-auto text-sm text-muted-foreground tabular-nums">
                  {String(value)}
                </span>
              )}
            </div>
            <OptionControl
              id={id}
              option={option}
              value={value}
              disabled={disabled || lock !== undefined}
              onChange={(v) => onChange(option.key, v)}
            />
            {by && (
              <p className="text-xs text-muted-foreground">
                {t('options.lockedBy', { option: t(by.labelKey) })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OptionControl({
  id,
  option,
  value,
  disabled,
  onChange,
}: {
  id: string;
  option: EngineOption;
  value: unknown;
  disabled?: boolean | undefined;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  useChoiceFonts(option.choices?.map((c) => c.font) ?? []);
  switch (option.type) {
    case 'number':
      return (
        <Slider
          id={id}
          min={option.min ?? 0}
          max={option.max ?? 100}
          step={option.step ?? 1}
          value={[Number(value)]}
          disabled={disabled}
          aria-label={t(option.labelKey)}
          onValueChange={([v]) => onChange(v)}
        />
      );
    case 'boolean':
      return (
        <Switch
          id={id}
          checked={Boolean(value)}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked)}
        />
      );
    case 'select':
      return (
        <Select value={String(value)} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(option.choices ?? []).map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                <span className="flex flex-col items-start">
                  <span style={choice.font ? choiceFontStyle(choice.font) : undefined}>
                    {t(choice.labelKey)}
                  </span>
                  {choice.helpKey && (
                    <span className="text-xs text-muted-foreground">{t(choice.helpKey)}</span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'file':
      return (
        <FileOption
          id={id}
          accept={option.accept ?? []}
          value={value instanceof File ? value : null}
          disabled={disabled}
          onChange={onChange}
        />
      );
    case 'string':
      return (
        <input
          id={id}
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full rounded-md border bg-transparent px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
      );
  }
}

/** A second file for the conversion (e.g. subtitles to burn in), kept in the browser until it runs. */
function FileOption({
  id,
  accept,
  value,
  disabled,
  onChange,
}: {
  id: string;
  accept: string[];
  value: File | null;
  disabled?: boolean | undefined;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const endings = accept.map((ext) => `.${ext}`).join(',');
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        ref={input}
        id={id}
        type="file"
        accept={endings}
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onChange(file);
          e.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <FileIcon aria-hidden="true" />
        {value ? t('convert.fileOption.change') : t('convert.fileOption.choose')}
      </Button>
      {value ? (
        <>
          <span className="min-w-0 truncate text-sm" title={value.name}>
            {value.name}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            disabled={disabled}
            aria-label={t('convert.fileOption.remove', { name: value.name })}
            onClick={() => onChange(null)}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">
          {t('convert.fileOption.accepts', {
            endings: accept.map((e) => e.toUpperCase()).join(', '),
          })}
        </span>
      )}
    </div>
  );
}
