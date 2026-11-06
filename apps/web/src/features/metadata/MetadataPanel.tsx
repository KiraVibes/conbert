import { useQuery } from '@tanstack/react-query';
import { Loader2Icon, MapPinIcon, RotateCcwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  METADATA_FIELDS,
  NO_METADATA_EDITS,
  ConversionError,
  commonFields,
  getFormat,
  groupMetadata,
  hasLocation,
  hasMetadataEdits,
  metadataFieldWritable,
  metadataGroupKey,
  metadataTagKey,
  metadataWritable,
  type MetadataEdits,
  type MetadataField,
} from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { useFiles, type FileItem } from '@/features/convert/files-store';
import { readMetadata } from './metadata-engine';

/**
 * Expert mode, tab "Metadaten": everything the file says about itself, plus
 * the common fields to change. Changes are written into the result on this
 * device after converting.
 */
export function MetadataPanel({
  item,
  targetExt,
  disabled,
}: {
  item: FileItem;
  targetExt: string;
  disabled?: boolean | undefined;
}) {
  const { t } = useTranslation();
  const setMetadata = useFiles((s) => s.setMetadata);
  const query = useQuery({
    queryKey: ['metadata-read', item.id, item.file],
    queryFn: () => readMetadata(item.file, item.ext),
    staleTime: Infinity,
    retry: false,
  });
  const edits = item.metadata ?? NO_METADATA_EDITS;
  const current = query.data ? commonFields(query.data) : {};
  const gps = query.data ? hasLocation(query.data) : false;
  const groups = query.data ? groupMetadata(query.data) : [];
  const writable = metadataWritable(targetExt);
  const id = (field: string) => `meta-${item.id}-${field}`;
  const update = (patch: Partial<MetadataEdits>) => setMetadata(item.id, { ...edits, ...patch });
  const setValue = (field: MetadataField, value: string) =>
    update({ values: { ...edits.values, [field]: value } });

  if (query.isPending) {
    return (
      <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
        {t('metadata.loading')}
      </p>
    );
  }
  if (query.error) {
    const error = query.error instanceof ConversionError ? query.error : null;
    return (
      <ErrorMessage
        messageKey={error?.messageKey ?? 'errors.metadataReadFailed'}
        details={error?.details ?? String(query.error)}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="metadata-panel">
      {gps && (
        <p
          role="note"
          className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <MapPinIcon className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
          {t('metadata.gpsWarning')}
        </p>
      )}
      {!writable && (
        <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          {t('metadata.notWritable', {
            format: t(getFormat(targetExt)?.nameKey ?? '', {
              defaultValue: targetExt.toUpperCase(),
            }),
          })}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {METADATA_FIELDS.map((field) => (
          <div key={field} className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor={id(field)}>{t(`metadata.fields.${field}.label`)}</Label>
              <HelpTip
                helpKey={`metadata.fields.${field}.help`}
                labelKey={`metadata.fields.${field}.label`}
              />
            </div>
            <Input
              id={id(field)}
              type={field === 'date' ? 'datetime-local' : 'text'}
              value={edits.values[field] ?? current[field] ?? ''}
              placeholder={t(`metadata.fields.${field}.placeholder`)}
              disabled={
                disabled || !writable || edits.removeAll || !metadataFieldWritable(targetExt, field)
              }
              title={
                writable && !metadataFieldWritable(targetExt, field)
                  ? t('metadata.fieldNotWritable')
                  : undefined
              }
              onChange={(e) => setValue(field, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {gps && (
          <SwitchRow
            id={id('remove-gps')}
            label={t('metadata.removeGps')}
            helpKey="metadata.removeGpsHelp"
            checked={edits.removeGps || edits.removeAll}
            disabled={disabled || !writable || edits.removeAll}
            onChange={(removeGps) => update({ removeGps })}
          />
        )}
        <SwitchRow
          id={id('remove-all')}
          label={t('metadata.removeAll')}
          helpKey="metadata.removeAllHelp"
          checked={edits.removeAll}
          disabled={disabled || !writable}
          onChange={(removeAll) => update({ removeAll })}
        />
      </div>

      {hasMetadataEdits(item.metadata) && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => setMetadata(item.id, NO_METADATA_EDITS)}
        >
          <RotateCcwIcon aria-hidden="true" />
          {t('metadata.reset')}
        </Button>
      )}

      <details className="rounded-lg border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          {t('metadata.all', { count: groups.reduce((n, g) => n + g.entries.length, 0) })}
        </summary>
        {groups.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground">{t('metadata.none')}</p>
        ) : (
          <div className="max-h-80 space-y-3 overflow-auto px-3 pb-3">
            {groups.map(({ group, entries }) => (
              <table key={group} className="w-full table-fixed text-xs">
                <caption className="pt-2 pb-1 text-left text-sm font-medium">
                  {metadataGroupKey(group) ? (
                    <>
                      {t(metadataGroupKey(group) ?? '')}{' '}
                      <span className="font-normal text-muted-foreground">({group})</span>
                    </>
                  ) : (
                    group
                  )}
                </caption>
                <tbody>
                  {entries.map(([name, value]) => (
                    <tr key={name} className="border-t align-top">
                      <th
                        scope="row"
                        className="w-2/5 py-1 pr-2 text-left font-normal text-muted-foreground"
                      >
                        <span className="block truncate" title={name}>
                          {metadataTagKey(name) ? t(metadataTagKey(name) ?? '') : name}
                        </span>
                      </th>
                      <td className="py-1 break-words">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        )}
      </details>
    </div>
  );
}

function SwitchRow(props: {
  id: string;
  label: string;
  helpKey: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={props.id}>{props.label}</Label>
        <HelpTip helpKey={props.helpKey} />
      </div>
      <Switch
        id={props.id}
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
      />
    </div>
  );
}
