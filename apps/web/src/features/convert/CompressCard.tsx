import { useEffect, useMemo, useState } from 'react';
import {
  CloudIcon,
  FileIcon,
  Loader2Icon,
  MonitorIcon,
  SquareIcon,
  TriangleAlertIcon,
  WandSparklesIcon,
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  COMPRESS_ALTERNATIVES,
  compressLevels,
  decideRoute,
  findRoutes,
  getFormat,
  listTargets,
  type CompressLevel,
  type TargetOption,
} from '@conbert/core';
import { Badge } from '@/components/ui/badge';
import { PurposeNoteLine } from './PurposePicker';
import { Button } from '@/components/ui/button';
import { useCover } from '@/lib/cover';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { HelpTip } from '@/components/HelpTip';
import { runtimesFor, useAvailableEngines } from '@/engines/use-engines';
import { PreviewDialog, type PreviewSide } from '@/features/preview/PreviewDialog';
import { useSettings } from '@/features/settings/settings-store';
import { formatBytes } from '@/lib/format-bytes';
import { ConversionStatus } from './ConversionStatus';
import { FileNameEditor } from './FileNameEditor';
import { FormatSelect } from './FormatSelect';
import { ModeSelector } from './ModeSelector';
import { CardTabs } from '@/features/metadata/CardTabs';
import { OptionsPanel } from './OptionsPanel';
import { formatName } from './format-text';
import { useFiles, type FileItem } from './files-store';
import { cancelConversion, runConversion } from './run-conversion';
import { useRemoveAfterDownload } from './use-remove-after-download';

/** Formats a file can be compressed into: the same one first, then smaller ones. */
function useCompressTargets(item: FileItem): TargetOption[] {
  const { engines, serverAvailable } = useAvailableEngines();
  return useMemo(() => {
    if (!item.ext) return [];
    const runtimes = runtimesFor(item.mode, serverAvailable);
    const same = runtimes.filter(
      (r) => findRoutes(engines, item.ext, item.ext, r, { compress: true }).length > 0,
    );
    const category = getFormat(item.ext)?.category;
    const alternatives = category ? (COMPRESS_ALTERNATIVES[category] ?? []) : [];
    const reachable = listTargets(engines, item.ext, runtimes).filter(
      (t) => alternatives.includes(t.ext) && t.ext !== item.ext,
    );
    return [
      ...(same.length > 0 ? [{ ext: item.ext, runtimes: same, steps: 1 }] : []),
      ...reachable,
    ];
  }, [engines, serverAvailable, item.ext, item.mode]);
}

/** One file in the "Komprimieren" tab. */
export function CompressCard({ item }: { item: FileItem }) {
  // Videos and music: a frame or the cover inside the file (made in the browser).
  const cover = useCover(item.previewUrl ? null : item.file, item.ext);
  const { t, i18n } = useTranslation();
  const { removeFile, setTarget, setMode, setOption, setCompress } = useFiles();
  const { engines, serverAvailable, serverHasGpu } = useAvailableEngines();
  const thresholdMb = useSettings((s) => s.autoServerThresholdMb);
  const expertMode = useSettings((s) => s.expertMode);
  const removeAfterDownload = useRemoveAfterDownload();
  const [preview, setPreview] = useState<PreviewSide | null>(null);
  const targets = useCompressTargets(item);
  const detecting = item.status === 'detecting';
  const busy = item.status === 'converting';
  const target = item.targetExt;

  // Start with the same format (or the first smaller one) – nothing to pick by hand.
  useEffect(() => {
    const first = targets[0];
    if (first && (!target || !targets.some((t) => t.ext === target))) setTarget(item.id, first.ext);
  }, [targets, target, item.id, setTarget]);

  const ctx = {
    serverAvailable,
    serverHasGpu,
    autoServerThresholdBytes: thresholdMb * 1024 * 1024,
  };
  const decision = target
    ? decideRoute(engines, item.ext, target, {
        ...ctx,
        mode: item.mode,
        fileSize: item.file.size,
        compress: true,
      })
    : null;
  const route = decision?.route ?? null;
  const lastStep = route?.steps.at(-1);
  const lastEngine = lastStep
    ? engines.find((e) => e.id === lastStep.engineId && e.runtime === lastStep.runtime)
    : undefined;
  const isImage = target ? getFormat(target)?.category === 'image' : false;
  const levels = compressLevels(getFormat(target ?? item.ext)?.category);
  const { level, targetMb, stripMetadata } = item.compress;
  const needsTarget = level === 'target' && !(targetMb && targetMb > 0);
  const convert = () => void runConversion(item, engines, ctx);

  return (
    <Card className="gap-3 p-4" data-testid="compress-card">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setPreview('original')}
          disabled={detecting}
          aria-label={t('preview.openNamed', { name: item.name })}
          title={t('preview.open')}
          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {(item.previewUrl ?? cover) ? (
            <img
              src={item.previewUrl ?? cover ?? undefined}
              alt=""
              className="size-full object-cover"
            />
          ) : detecting ? (
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <FileIcon className="size-6 text-muted-foreground" aria-hidden="true" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <FileNameEditor item={item} />
          <p className="text-sm text-muted-foreground">
            {detecting ? t('files.detecting') : formatName(t, item.ext)}
            {' · '}
            {formatBytes(item.file.size, i18n.language)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => removeFile(item.id)}
          disabled={busy}
          aria-label={t('files.removeNamed', { name: item.name })}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>

      {!detecting && targets.length === 0 && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-sm text-amber-800 dark:text-amber-300">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('compress.notPossible', { format: formatName(t, item.ext) })}
        </p>
      )}

      {!detecting && targets.length > 0 && (
        <>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label id={`level-${item.id}`}>{t('compress.level.label')}</Label>
              <HelpTip helpKey="compress.level.help" labelKey="compress.level.label" />
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={0}
              value={level}
              onValueChange={(v) => v && setCompress(item.id, { level: v as CompressLevel })}
              aria-labelledby={`level-${item.id}`}
              className="flex-wrap"
              disabled={busy}
            >
              {levels.map((l) => (
                <ToggleGroupItem key={l} value={l} className="px-3">
                  {t(`compress.level.${l}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-sm text-muted-foreground">{t(`compress.level.${level}Help`)}</p>
            {level === 'target' && (
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={`target-mb-${item.id}`}>{t('compress.targetMb')}</Label>
                <Input
                  id={`target-mb-${item.id}`}
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  step={0.1}
                  className="h-8 w-28"
                  value={targetMb ?? ''}
                  disabled={busy}
                  onChange={(e) => {
                    const value = Number(e.target.value.replace(',', '.'));
                    setCompress(item.id, { targetMb: value > 0 ? value : null });
                  }}
                />
                <span className="text-sm text-muted-foreground">
                  {t('compress.originalSize', { size: formatBytes(item.file.size, i18n.language) })}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor={`format-${item.id}`}>{t('compress.format')}</Label>
                <HelpTip helpKey="compress.formatHelp" labelKey="compress.format" />
              </div>
              <FormatSelect
                id={`format-${item.id}`}
                inputExt={item.ext}
                targets={targets}
                value={target}
                onChange={(ext) => setTarget(item.id, ext)}
                disabled={busy}
              />
            </div>
            <ModeSelector compact value={item.mode} onChange={(mode) => setMode(item.id, mode)} />
          </div>

          {isImage && (
            <div className="flex items-center gap-2">
              <Switch
                id={`strip-${item.id}`}
                checked={stripMetadata}
                onCheckedChange={(checked) => setCompress(item.id, { stripMetadata: checked })}
                disabled={busy}
              />
              <Label htmlFor={`strip-${item.id}`}>{t('options.stripMetadata.label')}</Label>
              <HelpTip
                helpKey="options.stripMetadata.help"
                effectKey="options.stripMetadata.effect"
                labelKey="options.stripMetadata.label"
              />
            </div>
          )}

          {route && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary" className="gap-1">
                {route.runtime === 'browser' ? (
                  <MonitorIcon className="size-3" aria-hidden="true" />
                ) : (
                  <CloudIcon className="size-3" aria-hidden="true" />
                )}
                {t(route.runtime === 'browser' ? 'mode.local.label' : 'mode.server.label')}
              </Badge>
              {item.mode === 'auto' &&
                decision &&
                t(`routing.reasons.${decision.reason}`, {
                  threshold: formatBytes(thresholdMb * 1024 * 1024, i18n.language),
                })}
            </p>
          )}
          {!route && decision && (
            <p className="text-sm text-amber-800 dark:text-amber-300">
              {t(`routing.reasons.${decision.reason}`)}
            </p>
          )}

          {item.purpose && <PurposeNoteLine note={item.purpose} />}

          {expertMode && route && target && lastEngine && (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{t('compress.expertHint')}</p>
              <CardTabs item={item} targetExt={target} disabled={busy}>
                <OptionsPanel
                  idPrefix={`copt-${item.id}`}
                  options={lastEngine.options}
                  outputExt={target}
                  values={item.options}
                  onChange={(key, value) => setOption(item.id, key, value)}
                  disabled={busy}
                />
              </CardTabs>
            </div>
          )}

          {route && item.status !== 'done' && (
            <div className="flex gap-2">
              {busy ? (
                <Button variant="outline" onClick={() => cancelConversion(item.id)}>
                  <SquareIcon aria-hidden="true" />
                  {t('convert.cancel')}
                </Button>
              ) : (
                <Button onClick={convert} disabled={needsTarget}>
                  <WandSparklesIcon aria-hidden="true" />
                  {t('compress.start')}
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <ConversionStatus
        item={item}
        onRetry={convert}
        onDownloaded={() => removeAfterDownload([item.id])}
        onPreview={() => setPreview('result')}
      />

      {preview && (
        <PreviewDialog
          item={item}
          open
          initial={preview}
          onOpenChange={(open) => !open && setPreview(null)}
        />
      )}
    </Card>
  );
}
