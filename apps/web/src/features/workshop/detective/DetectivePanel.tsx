import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightIcon,
  CircleCheckIcon,
  DownloadIcon,
  FileArchiveIcon,
  LockIcon,
  ScanEyeIcon,
  SearchIcon,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import type { DetectiveReport, Finding, ZipEntry } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { formatName } from '@/features/convert/format-text';
import { formatBytes } from '@/lib/format-bytes';
import { useWorkshopTrick } from '@/lib/use-view';
import { cn } from '@/lib/utils';
import { hex } from '../save-blob';
import { carvePart, extractEntry, runScan, unlockEntry } from '../workshop-worker';
import { partName, saveResult } from './save-part';
import { SaveAllParts } from './SaveAllParts';

function findingText(t: TFunction, f: Finding, language: string): string {
  const values: Record<string, string | number> = { ...f.values };
  if (typeof values['bytes'] === 'number') values['bytes'] = formatBytes(values['bytes'], language);
  values['format'] = f.format ? formatName(t, f.format) : '';
  return t(`workshop.detective.findings.${f.key}`, values);
}

function EntryList({
  file,
  finding,
  entries,
}: {
  file: File;
  finding: Finding;
  entries: ZipEntry[];
}) {
  const { t, i18n } = useTranslation();
  const [password, setPassword] = useState('');
  const files = entries.filter((e) => !e.directory);
  const locked = files.some((e) => e.encrypted);
  const passwordId = `entries-password-${finding.offset}`;
  const save = (entry: ZipEntry) => {
    const name = entry.name.split('/').pop() || entry.name;
    const result = entry.encrypted
      ? unlockEntry(file, finding.offset, finding.length, entry, password)
      : extractEntry(file, finding.offset, finding.length, entry);
    void result.then((r) => saveResult(r, name, t));
  };
  return (
    <div className="space-y-2">
      {locked && (
        <div className="max-w-sm space-y-1">
          <Label htmlFor={passwordId}>{t('workshop.detective.entriesPassword')}</Label>
          <Input
            id={passwordId}
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      )}
      <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border text-sm">
        {files.map((entry) => (
          <li key={`${entry.offset}-${entry.name}`} className="flex items-center gap-2 px-3 py-1.5">
            {entry.encrypted && (
              <LockIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-label={t('workshop.detective.encrypted')}
              />
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatBytes(entry.size, i18n.language)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('workshop.detective.saveEntry', { name: entry.name })}
              disabled={entry.encrypted && !password}
              title={
                entry.encrypted && !password ? t('workshop.detective.needsPassword') : undefined
              }
              onClick={() => save(entry)}
            >
              <DownloadIcon aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      {locked && (
        <p className="text-sm text-muted-foreground">{t('workshop.detective.encryptedHint')}</p>
      )}
    </div>
  );
}

function FindingCard({
  file,
  finding,
  onShowOffset,
}: {
  file: File;
  finding: Finding;
  onShowOffset?: (offset: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const [, openTrick] = useWorkshopTrick();
  // Parts that are a file of their own can be saved; traces of a trick open in that trick.
  const canSave = !finding.trick && finding.kind !== 'text-note' && finding.kind !== 'zero-width';
  return (
    <li
      className={cn(
        'space-y-3 rounded-lg border p-4',
        finding.hidden && 'border-amber-500/40 bg-amber-500/5',
      )}
    >
      <div className="flex items-start gap-3">
        {finding.entries ? (
          <FileArchiveIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        ) : (
          <ScanEyeIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{findingText(t, finding, i18n.language)}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {t('workshop.detective.where', {
              offset: `0x${hex(finding.offset, 2)}`,
              size: formatBytes(finding.length, i18n.language),
            })}
          </p>
        </div>
      </div>
      {finding.text && (
        <pre className="max-h-48 overflow-auto rounded-md bg-muted/60 p-3 text-sm whitespace-pre-wrap">
          {finding.text}
        </pre>
      )}
      {finding.kind === 'zero-width' && (
        <p className="text-sm text-muted-foreground">{t('workshop.detective.zeroWidthHint')}</p>
      )}
      {finding.kind === 'lsb' && (
        <p className="text-sm text-muted-foreground">{t('workshop.detective.lsbHint')}</p>
      )}
      {finding.trick && (
        <p className="text-sm text-muted-foreground">{t('workshop.detective.trickHint')}</p>
      )}
      {finding.entries && finding.entries.length > 0 && (
        <EntryList file={file} finding={finding} entries={finding.entries} />
      )}
      <div className="flex flex-wrap gap-2">
        {canSave && (
          <Button
            size="sm"
            onClick={() =>
              void carvePart(file, finding.offset, finding.length, finding.format).then((r) =>
                saveResult(r, partName(file.name, finding.offset, finding.format), t),
              )
            }
          >
            <DownloadIcon aria-hidden="true" />
            {finding.entries
              ? t('workshop.detective.saveArchive')
              : t('workshop.detective.savePart')}
          </Button>
        )}
        {finding.trick && (
          <Button size="sm" onClick={() => openTrick(finding.trick ?? null)}>
            <ArrowRightIcon aria-hidden="true" />
            {t('workshop.detective.openTrick', {
              trick: t(`workshop.tricks.${finding.trick}.title`),
            })}
          </Button>
        )}
        {onShowOffset && (
          <Button size="sm" variant="outline" onClick={() => onShowOffset(finding.offset)}>
            {t('workshop.identify.showAppended')}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * "Detektiv-Scan": searches the whole file and lets you take out what it
 * finds. `only` narrows it down (the archive tricks show just archives).
 */
export function DetectivePanel({
  file,
  ext,
  onShowOffset,
  only,
}: {
  file: File;
  ext: string | null;
  onShowOffset?: (offset: number) => void;
  only?: (finding: Finding) => boolean;
}) {
  const { t, i18n } = useTranslation();
  const [report, setReport] = useState<DetectiveReport | null>(null);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // The panel is keyed by the file, so this runs once per file.
    let active = true;
    runScan(file, ext, (bytes) => active && setDone(bytes))
      .then((r) => active && setReport(r))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [file, ext]);

  if (failed) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('workshop.detective.failed')}
      </p>
    );
  }
  if (!report) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <SearchIcon
          className="size-4 animate-pulse motion-reduce:animate-none"
          aria-hidden="true"
        />
        <span>{t('workshop.detective.scanning')}</span>
        <Progress
          value={file.size ? (done / file.size) * 100 : 0}
          className="max-w-48 flex-1"
          aria-label={t('workshop.detective.scanning')}
        />
      </div>
    );
  }

  const findings = only ? report.findings.filter(only) : report.findings;
  const hidden = findings.filter((f) => f.hidden);
  const normal = findings.filter((f) => !f.hidden);
  return (
    <div className="space-y-5">
      <div
        role="status"
        className={cn(
          'flex items-start gap-3 rounded-lg border p-4',
          hidden.length > 0
            ? 'border-amber-500/40 bg-amber-500/10'
            : 'border-emerald-600/30 bg-emerald-600/5',
        )}
      >
        {hidden.length > 0 ? (
          <ScanEyeIcon
            className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
        ) : (
          <CircleCheckIcon
            className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
        )}
        <div className="space-y-1">
          <p className="font-medium">
            {hidden.length > 0
              ? t('workshop.detective.found', { count: hidden.length })
              : t('workshop.detective.clean')}
          </p>
          <p className="text-sm text-muted-foreground">
            {t('workshop.detective.scanned', { size: formatBytes(file.size, i18n.language) })}
          </p>
        </div>
      </div>

      <SaveAllParts file={file} findings={findings} />

      {hidden.length > 0 && (
        <ul className="space-y-3">
          {hidden.map((f) => (
            <FindingCard
              key={`${f.kind}-${f.offset}`}
              file={file}
              finding={f}
              onShowOffset={onShowOffset}
            />
          ))}
        </ul>
      )}

      {normal.length > 0 && (
        <details className="rounded-lg border px-3 py-2" open={hidden.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">
            {t('workshop.detective.normal', { count: normal.length })}
          </summary>
          <ul className="mt-3 space-y-3">
            {normal.map((f) => (
              <FindingCard
                key={`${f.kind}-${f.offset}`}
                file={file}
                finding={f}
                onShowOffset={onShowOffset}
              />
            ))}
          </ul>
        </details>
      )}

      {report.truncated && (
        <p className="text-sm text-muted-foreground">{t('workshop.detective.truncated')}</p>
      )}
    </div>
  );
}
