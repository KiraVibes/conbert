import { useMemo, useRef, useState } from 'react';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  FilePlusIcon,
  HistoryIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import { formatTimecode, readTrim, type EngineDescriptor } from '@conbert/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAvailableEngines } from '@/engines/use-engines';
import { formatName } from '@/features/convert/format-text';
import { useFiles } from '@/features/convert/files-store';
import { formatBytes } from '@/lib/format-bytes';
import { useView } from '@/lib/use-view';
import { dayLabel } from './day-label';
import { describeOptions, routeNames, type OptionRow } from './describe-job';
import { JOB_LOG_DAYS, sessionFile, useJobLog, type JobRecord } from './job-log';

function optionValue(t: TFunction, row: OptionRow): string {
  switch (row.value.kind) {
    case 'key':
      return t(row.value.key);
    case 'switch':
      return t(row.value.on ? 'history.on' : 'history.off');
    default:
      return row.value.text;
  }
}

function seconds(ms: number, language: string): string {
  return (ms / 1000).toLocaleString(language, { maximumFractionDigits: 1 });
}

function JobSettings({
  record,
  engines,
}: {
  record: JobRecord;
  engines: readonly EngineDescriptor[];
}) {
  const { t, i18n } = useTranslation();
  const rows = describeOptions(engines, record.engineIds, record.options);
  const route = routeNames(engines, record.engineIds);
  const trim = readTrim(record.options);
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {record.compress && (
        <>
          <dt className="text-muted-foreground">{t('compress.level.label')}</dt>
          <dd>
            {record.compress.level === 'target' && record.compress.targetMb
              ? t('history.targetSize', {
                  size: record.compress.targetMb.toLocaleString(i18n.language),
                })
              : t(`compress.level.${record.compress.level}`)}
          </dd>
          <dt className="text-muted-foreground">{t('history.stripMetadata')}</dt>
          <dd>{t(record.compress.stripMetadata ? 'history.on' : 'history.off')}</dd>
        </>
      )}
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <dt className="text-muted-foreground">{t(row.labelKey)}</dt>
          <dd>{optionValue(t, row)}</dd>
        </div>
      ))}
      {rows.length === 0 && !record.compress && !trim && (
        <dd className="col-span-2 text-muted-foreground">{t('history.defaults')}</dd>
      )}
      {trim && (
        <>
          <dt className="text-muted-foreground">{t('history.trim')}</dt>
          <dd>
            {formatTimecode(trim.start)} –{' '}
            {trim.end === null ? t('trim.toEnd') : formatTimecode(trim.end)}
            {trim.fast && ` (${t('history.trimFast')})`}
          </dd>
        </>
      )}
      <dt className="text-muted-foreground">{t('history.mode')}</dt>
      <dd>{t(`history.modes.${record.mode}`)}</dd>
      {route && (
        <>
          <dt className="text-muted-foreground">{t('history.engines')}</dt>
          <dd>{route}</dd>
        </>
      )}
      {record.durationMs !== undefined && (
        <>
          <dt className="text-muted-foreground">{t('history.duration')}</dt>
          <dd>{t('history.seconds', { value: seconds(record.durationMs, i18n.language) })}</dd>
        </>
      )}
      {record.errorKey && (
        <>
          <dt className="text-muted-foreground">{t('errorParts.cause')}</dt>
          <dd>{t(`${record.errorKey}.cause`)}</dd>
          <dt className="text-muted-foreground">{t('errorParts.action')}</dt>
          <dd>{t(`${record.errorKey}.action`)}</dd>
        </>
      )}
    </dl>
  );
}

function JobCard({
  record,
  engines,
  onAgain,
  onOtherFile,
}: {
  record: JobRecord;
  engines: readonly EngineDescriptor[];
  onAgain: () => void;
  onOtherFile: () => void;
}) {
  const { t, i18n } = useTranslation();
  const remove = useJobLog((s) => s.remove);
  const time = new Date(record.createdAt).toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const failed = record.status === 'error';
  const where = record.runtime ? t(`history.ranOn.${record.runtime}`) : null;
  const size =
    record.resultSize !== undefined
      ? `${formatBytes(record.sourceSize, i18n.language)} → ${formatBytes(record.resultSize, i18n.language)}`
      : formatBytes(record.sourceSize, i18n.language);
  return (
    <Card className="gap-2 p-3" data-testid="history-entry">
      <div className="flex items-start gap-3">
        {failed ? (
          <CircleAlertIcon
            className="mt-0.5 size-5 shrink-0 text-destructive"
            aria-label={t('history.failed')}
          />
        ) : (
          <CircleCheckIcon
            className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-label={t('history.done')}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={record.sourceName}>
            {record.sourceName}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(record.task === 'compress' ? 'history.compressed' : 'history.converted', {
              from: formatName(t, record.sourceExt),
              to: formatName(t, record.targetExt),
            })}
            {' · '}
            {size}
            {record.keptOriginal && ` · ${t('archive.keptOriginal')}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {time}
            {where && ` · ${where}`}
          </p>
          {failed && record.errorKey && (
            <p className="mt-1 text-sm text-destructive">{t(`${record.errorKey}.what`)}</p>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0"
          onClick={() => remove(record.id)}
          aria-label={t('history.removeNamed', { name: record.sourceName })}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <details className="pl-8">
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
          {t('history.settings')}
        </summary>
        <JobSettings record={record} engines={engines} />
      </details>
      <div className="flex flex-wrap gap-2 pl-8">
        <Button size="sm" variant="outline" onClick={onAgain}>
          <RotateCcwIcon aria-hidden="true" />
          {t('history.again')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onOtherFile}>
          <FilePlusIcon aria-hidden="true" />
          {t('history.otherFile')}
        </Button>
      </div>
    </Card>
  );
}

/** Every job with its settings – run it again on the same or a new file. */
export function JobLogView() {
  const { t, i18n } = useTranslation();
  const records = useJobLog((s) => s.records);
  const clear = useJobLog((s) => s.clear);
  const addFiles = useFiles((s) => s.addFiles);
  const { engines } = useAvailableEngines();
  const [, navigate] = useView();
  const input = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState<JobRecord | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, JobRecord[]>();
    for (const record of records) {
      const label = dayLabel(record.createdAt, i18n.language, t);
      map.set(label, [...(map.get(label) ?? []), record]);
    }
    return [...map.entries()];
  }, [records, i18n.language, t]);

  const start = (record: JobRecord, files: File[]) => {
    if (files.length === 0) return;
    void addFiles(files, record.mode, record.task, {
      targetExt: record.targetExt,
      options: record.options,
      ...(record.compress && { compress: record.compress }),
    });
    navigate(record.task === 'compress' ? 'compress' : 'home');
    toast.success(t('history.ready', { count: files.length }));
  };

  const pick = (record: JobRecord) => {
    setPicking(record);
    input.current?.click();
  };

  const again = (record: JobRecord) => {
    const file = sessionFile(record.id);
    if (file) start(record, [file]);
    else pick(record);
  };

  return (
    <div className="space-y-6">
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid="history-file-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (picking) start(picking, files);
          setPicking(null);
        }}
      />
      {records.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <HistoryIcon className="size-6" aria-hidden="true" />
          <p>{t('history.empty')}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {t('history.summary', { count: records.length, days: JOB_LOG_DAYS })}
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Trash2Icon aria-hidden="true" />
                  {t('history.clear')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('history.clearTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('history.clearText')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('archive.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={clear}>{t('history.clearConfirm')}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          {groups.map(([label, list]) => (
            <section key={label} className="space-y-2" aria-label={label}>
              <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
              <ul className="space-y-2">
                {list.map((record) => (
                  <li key={record.id}>
                    <JobCard
                      record={record}
                      engines={engines}
                      onAgain={() => again(record)}
                      onOtherFile={() => pick(record)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
