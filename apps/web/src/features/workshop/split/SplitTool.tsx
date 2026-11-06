import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, ScissorsIcon, XIcon } from 'lucide-react';
import {
  SPLIT_MAX_MB,
  SPLIT_MAX_PARTS,
  SPLIT_MIN_MB,
  SPLIT_PRESETS_MB,
  joinPlan,
  megabytes,
  splitPlan,
  type JoinProblem,
} from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dropzone } from '@/features/convert/Dropzone';
import { formatBytes } from '@/lib/format-bytes';
import { saveBlob } from '@/lib/zip';
import { HowItWorks, SingleFile } from '../SingleFile';

/** Browsers ask once before a page saves many files; a short pause between them helps. */
async function saveAll(items: { blob: Blob; name: string }[]) {
  for (const item of items) {
    saveBlob(item.blob, item.name);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

function SplitPanel() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [mb, setMb] = useState<number>(25);
  const [text, setText] = useState('25');
  const parts = useMemo(
    () => (file ? splitPlan(file.name, file.size, megabytes(mb)) : null),
    [file, mb],
  );
  const blobs = useMemo(
    () => (file && parts ? parts.map((p) => ({ ...p, blob: file.slice(p.start, p.end) })) : []),
    [file, parts],
  );
  const commit = (value: string) => {
    const n = Number(value.replace(',', '.'));
    if (Number.isFinite(n) && n >= SPLIT_MIN_MB && n <= SPLIT_MAX_MB) setMb(n);
    else setText(String(mb));
  };

  return (
    <div className="space-y-4">
      <SingleFile file={file} onFile={setFile} />
      <div className="space-y-2">
        <Label htmlFor="split-size" className="flex items-center gap-1">
          {t('workshop.split.size')}
          <HelpTip helpKey="workshop.split.sizeHelp" labelKey="workshop.split.size" />
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          {SPLIT_PRESETS_MB.map((preset) => (
            <Button
              key={preset}
              size="sm"
              variant={mb === preset ? 'default' : 'outline'}
              aria-pressed={mb === preset}
              onClick={() => {
                setMb(preset);
                setText(String(preset));
              }}
            >
              {formatBytes(preset * 1024 * 1024, i18n.language)}
            </Button>
          ))}
          <span className="flex items-center gap-1.5">
            <Input
              id="split-size"
              value={text}
              inputMode="decimal"
              className="w-24 tabular-nums"
              onChange={(e) => setText(e.target.value)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(text);
              }}
            />
            <span className="text-sm text-muted-foreground">MB</span>
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t('workshop.split.presetHint')}</p>
      </div>

      {file && !parts && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.split.tooMany', { max: SPLIT_MAX_PARTS })}
        </p>
      )}
      {file && parts && parts.length === 1 && (
        <p className="text-sm text-muted-foreground">{t('workshop.split.fitsAlready')}</p>
      )}
      {file && parts && parts.length > 1 && (
        <Card className="gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{t('workshop.split.result', { count: parts.length })}</p>
            <Button size="sm" onClick={() => void saveAll(blobs)}>
              <DownloadIcon aria-hidden="true" />
              {t('workshop.split.saveAll')}
            </Button>
          </div>
          <ul className="max-h-72 divide-y overflow-y-auto text-sm">
            {blobs.map((part) => (
              <li key={part.number} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{part.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatBytes(part.blob.size, i18n.language)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('workshop.split.savePart', { name: part.name })}
                  title={t('workshop.split.savePart', { name: part.name })}
                  onClick={() => saveBlob(part.blob, part.name)}
                >
                  <DownloadIcon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('workshop.split.howToJoin')}</p>
        </Card>
      )}
    </div>
  );
}

function problemText(t: (key: string, o?: Record<string, unknown>) => string, p: JoinProblem) {
  switch (p.kind) {
    case 'notParts':
      return t('workshop.split.problems.notParts');
    case 'mixed':
      return t('workshop.split.problems.mixed', { names: p.bases.join(', ') });
    case 'duplicate':
      return t('workshop.split.problems.duplicate', { number: String(p.number).padStart(3, '0') });
    case 'missing':
      return t('workshop.split.problems.missing', {
        numbers: p.numbers.map((n) => String(n).padStart(3, '0')).join(', '),
      });
  }
}

function JoinPanel() {
  const { t, i18n } = useTranslation();
  const [parts, setParts] = useState<File[]>([]);
  const check = useMemo(
    () =>
      parts.length > 0
        ? joinPlan(
            parts,
            (f) => f.name,
            (f) => f.size,
          )
        : null,
    [parts],
  );
  const add = (files: File[]) =>
    setParts((old) => {
      // The same part dropped again replaces the old one.
      const names = new Set(files.map((f) => f.name));
      return [...old.filter((f) => !names.has(f.name)), ...files];
    });
  const total = parts.reduce((n, f) => n + f.size, 0);

  return (
    <div className="space-y-4">
      <Dropzone compact onFiles={add} />
      {parts.length > 0 && (
        <Card className="gap-3 px-4 py-3">
          <ul className="max-h-72 divide-y overflow-y-auto text-sm">
            {(check?.ok ? check.plan.parts : parts).map((part) => (
              <li key={part.name} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{part.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatBytes(part.size, i18n.language)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('workshop.split.removePart', { name: part.name })}
                  title={t('workshop.split.removePart', { name: part.name })}
                  onClick={() => setParts((old) => old.filter((f) => f !== part))}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          {check && !check.ok && (
            <p role="alert" className="text-sm text-destructive">
              {problemText(t, check.problem)}
            </p>
          )}
          {check?.ok && (
            <div className="space-y-2">
              {check.plan.maybeIncomplete && (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  {t('workshop.split.maybeMore')}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => saveBlob(new Blob(check.plan.parts), check.plan.name)}
                >
                  <DownloadIcon aria-hidden="true" />
                  {t('workshop.split.saveJoined', { name: check.plan.name })}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {formatBytes(total, i18n.language)}
                </span>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** Datei-Splitter/Joiner: big files in parts for upload limits, and back again. */
export function SplitTool() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <HowItWorks trick="split" />
      <Tabs defaultValue="split" className="gap-4">
        <TabsList>
          <TabsTrigger value="split">
            <ScissorsIcon aria-hidden="true" />
            {t('workshop.split.splitTab')}
          </TabsTrigger>
          <TabsTrigger value="join">{t('workshop.split.joinTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="split" forceMount className="data-[state=inactive]:hidden">
          <SplitPanel />
        </TabsContent>
        <TabsContent value="join" forceMount className="data-[state=inactive]:hidden">
          <JoinPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
