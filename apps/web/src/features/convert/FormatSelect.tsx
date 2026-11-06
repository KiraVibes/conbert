import { useTranslation } from 'react-i18next';
import { getFormat, recommendedTargets, type TargetOption } from '@conbert/core';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatName } from './format-text';

interface FormatSelectProps {
  id?: string;
  /** Input format, used to pick the recommendations. Omit for "all files". */
  inputExt?: string;
  targets: TargetOption[];
  value: string | null;
  onChange: (ext: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Target format dropdown: only valid targets, recommended ones first (⭐),
 * every entry with a one-line description.
 */
export function FormatSelect(props: FormatSelectProps) {
  const { id, inputExt, targets, value, onChange, disabled, className } = props;
  const { t } = useTranslation();
  const recs = inputExt ? recommendedTargets(inputExt) : [];
  const available = new Set(targets.map((x) => x.ext));
  const recommended = recs.filter((ext) => available.has(ext));
  const others = targets
    .map((x) => x.ext)
    .filter((ext) => !recommended.includes(ext))
    .sort((a, b) => formatName(t, a).localeCompare(formatName(t, b)));

  const item = (ext: string, star: boolean) => {
    const info = getFormat(ext);
    return (
      <SelectItem key={ext} value={ext} textValue={formatName(t, ext)}>
        <span className="flex flex-col items-start">
          <span className="font-medium">
            {star && <span aria-hidden="true">⭐ </span>}
            {formatName(t, ext)}
          </span>
          {info && (
            <span className="max-w-72 text-xs text-muted-foreground">{t(info.summaryKey)}</span>
          )}
        </span>
      </SelectItem>
    );
  };

  return (
    <Select
      value={value ?? ''}
      onValueChange={onChange}
      disabled={disabled || targets.length === 0}
    >
      <SelectTrigger id={id} className={className ?? 'w-full sm:w-64'}>
        <SelectValue placeholder={t('convert.targetPlaceholder')}>
          {value ? formatName(t, value) : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {recommended.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t('convert.recommended')}</SelectLabel>
            {recommended.map((ext) => item(ext, true))}
          </SelectGroup>
        )}
        {others.length > 0 && (
          <SelectGroup>
            {recommended.length > 0 && <SelectLabel>{t('convert.otherFormats')}</SelectLabel>}
            {others.map((ext) => item(ext, false))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
