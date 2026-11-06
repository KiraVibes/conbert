import { useTranslation } from 'react-i18next';
import { CircleCheckIcon, CircleXIcon } from 'lucide-react';
import type { RegionField } from '@conbert/core';
import { cn } from '@/lib/utils';
import { hex } from '../save-blob';

/** The single values of a block: which bytes mean what ("bytes 16–19: width = 800"). */
export function FieldTable({
  fields,
  selected,
  onPick,
}: {
  fields: RegionField[];
  /** The selected byte – its field is highlighted. */
  selected: number;
  onPick: (offset: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const show = (f: RegionField) => {
    const value = typeof f.value === 'number' ? f.value.toLocaleString(i18n.language) : f.value;
    return f.valueKey ? `${value} – ${t(`workshop.fieldValues.${f.valueKey}`)}` : value;
  };
  return (
    <table className="mt-2 w-full text-xs">
      <caption className="sr-only">{t('workshop.hex.fieldsTitle')}</caption>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="py-1 pr-3 font-medium">{t('workshop.hex.fieldBytes')}</th>
          <th className="py-1 pr-3 font-medium">{t('workshop.hex.fieldName')}</th>
          <th className="py-1 font-medium">{t('workshop.hex.fieldValue')}</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => {
          const active = selected >= f.start && selected < f.end;
          return (
            <tr
              key={`${f.start}-${f.key}`}
              className={cn(
                'cursor-pointer hover:bg-muted/70',
                active && 'bg-primary/15 font-medium',
              )}
              onClick={() => onPick(f.start)}
            >
              <td className="py-1 pr-3 font-mono whitespace-nowrap">
                0x{hex(f.start, 2)}
                {f.end - f.start > 1 && `–0x${hex(f.end - 1, 2)}`}
              </td>
              <td className="py-1 pr-3">
                <button
                  type="button"
                  className="text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPick(f.start);
                  }}
                >
                  {t(`workshop.fields.${f.key}`)}
                </button>
              </td>
              <td className="py-1 break-all">
                <span className="inline-flex items-center gap-1">
                  {show(f)}
                  {f.ok === true && (
                    <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400">
                      <CircleCheckIcon className="size-3.5" aria-hidden="true" />
                      {t('workshop.hex.checkOk')}
                    </span>
                  )}
                  {f.ok === false && (
                    <span className="inline-flex items-center gap-0.5 text-destructive">
                      <CircleXIcon className="size-3.5" aria-hidden="true" />
                      {t('workshop.hex.checkBad')}
                    </span>
                  )}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
