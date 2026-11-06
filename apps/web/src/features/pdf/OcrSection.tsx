import { useTranslation } from 'react-i18next';
import type { EngineDescriptor } from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { OptionsPanel } from '@/features/convert/OptionsPanel';

/** "Make text recognisable": switch plus the OCR settings. */
export function OcrSection({
  engine,
  on,
  onToggle,
  values,
  onChange,
  disabled,
}: {
  engine: EngineDescriptor | null;
  on: boolean;
  onToggle: (on: boolean) => void;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Switch
          id="pdf-ocr"
          checked={on && engine !== null}
          disabled={disabled || engine === null}
          onCheckedChange={onToggle}
        />
        <Label htmlFor="pdf-ocr">{t('pdf.ocr.label')}</Label>
        <HelpTip helpKey="pdf.ocr.help" labelKey="pdf.ocr.label" />
      </div>
      <p className="text-sm text-muted-foreground">
        {engine ? t('pdf.ocr.hint') : t('pdf.ocr.unavailable')}
      </p>
      {on && engine && (
        <OptionsPanel
          idPrefix="pdf-ocr"
          options={engine.options}
          outputExt="pdf"
          values={values}
          onChange={onChange}
          disabled={disabled}
        />
      )}
    </div>
  );
}
