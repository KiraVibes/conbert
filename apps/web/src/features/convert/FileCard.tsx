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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { findRoutes } from '@conbert/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCover } from '@/lib/cover';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ErrorMessage } from '@/components/ErrorMessage';
import { PreviewDialog, type PreviewSide } from '@/features/preview/PreviewDialog';
import { useEngineStatus } from '@/engines/engine-status-store';
import { useAvailableEngines } from '@/engines/use-engines';
import { useSettings } from '@/features/settings/settings-store';
import { formatBytes } from '@/lib/format-bytes';
import { ConversionStatus } from './ConversionStatus';
import { useFiles, type FileItem } from './files-store';
import { CardTabs } from '@/features/metadata/CardTabs';
import { OptionsPanel } from './OptionsPanel';
import { cancelConversion, runConversion } from './run-conversion';
import { formatName } from './format-text';
import { FileNameEditor } from './FileNameEditor';
import { FormatSelect } from './FormatSelect';
import { PurposeNoteLine } from './PurposePicker';
import { TrimSection } from './TrimSection';
import { useCanTrim } from './use-can-trim';
import { ImageAiSection } from './ImageAiSection';
import { canUseImageAi, imageAiEngine } from './image-ai';
import { ModeSelector } from './ModeSelector';
import { useRemoveAfterDownload } from './use-remove-after-download';
import { useFileRouting } from './use-file-routing';

export function FileCard({ item, children }: { item: FileItem; children?: React.ReactNode }) {
  // Videos and music: a frame or the cover inside the file (made in the browser).
  const cover = useCover(item.previewUrl ? null : item.file, item.ext);
  const { t, i18n } = useTranslation();
  const { removeFile, setTarget, setMode, setOption } = useFiles();
  const { engines, serverAvailable, serverHasGpu } = useAvailableEngines();
  const engineStatuses = useEngineStatus((s) => s.engines);
  const thresholdMb = useSettings((s) => s.autoServerThresholdMb);
  const routing = useFileRouting(item);
  const canTrim = useCanTrim(item) && item.status !== 'detecting';
  const canImageAi =
    item.task === 'convert' &&
    item.status !== 'detecting' &&
    canUseImageAi(item.ext) &&
    imageAiEngine(engines, serverAvailable) !== null;
  const removeAfterDownload = useRemoveAfterDownload();
  const [preview, setPreview] = useState<PreviewSide | null>(null);
  const { decision } = routing;
  const detecting = item.status === 'detecting';
  const busy = item.status === 'converting';
  const route = decision?.route ?? null;
  const steps = route?.steps ?? [];
  const lastStep = steps.at(-1);
  const lastEngine = lastStep
    ? engines.find((e) => e.id === lastStep.engineId && e.runtime === lastStep.runtime)
    : undefined;
  const hasServerRoute =
    serverAvailable &&
    item.targetExt !== null &&
    findRoutes(engines, item.ext, item.targetExt, 'server').length > 0;
  // Why the browser can't help (e.g. no HTTPS on a LAN address), if it can't.
  const browserBlockedKey = Object.values(engineStatuses).find(
    (s) => s.status === 'error' && s.messageKey,
  )?.messageKey;
  const showBrowserBlocked =
    item.mode !== 'server' &&
    browserBlockedKey !== undefined &&
    !detecting &&
    (routing.targets.length === 0 || (item.targetExt !== null && !route));
  const ctx = {
    serverAvailable,
    serverHasGpu,
    autoServerThresholdBytes: thresholdMb * 1024 * 1024,
  };
  const convert = () => void runConversion(item, engines, ctx);
  const retryOnServer = () => {
    setMode(item.id, 'server');
    void runConversion({ ...item, mode: 'server', status: 'idle' }, engines, ctx);
  };

  return (
    <Card className="gap-3 p-4" data-testid="file-card">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setPreview('original')}
          disabled={detecting}
          aria-label={t('preview.openNamed', { name: item.name })}
          title={t('preview.open')}
          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
            {detecting
              ? t('files.detecting')
              : item.ext
                ? formatName(t, item.ext)
                : t('files.unknownType')}
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

      {item.extMismatch && item.nameExt && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-sm text-amber-800 dark:text-amber-300">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('files.mismatch', { nameExt: item.nameExt, format: formatName(t, item.ext) })}
        </p>
      )}

      {!detecting && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <Label htmlFor={`target-${item.id}`}>{t('convert.target')}</Label>
            {routing.targets.length > 0 ? (
              <FormatSelect
                id={`target-${item.id}`}
                inputExt={item.ext}
                targets={routing.targets}
                value={item.targetExt}
                onChange={(ext) => setTarget(item.id, ext)}
                disabled={busy}
              />
            ) : (
              <p id={`target-${item.id}`} className="text-sm text-muted-foreground">
                {t('convert.noTargets')}
              </p>
            )}
          </div>
          <ModeSelector compact value={item.mode} onChange={(mode) => setMode(item.id, mode)} />
        </div>
      )}

      {item.purpose && <PurposeNoteLine note={item.purpose} />}

      {item.targetExt && decision && (
        <div className="space-y-1.5 text-sm">
          {route && (
            <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <Badge variant="secondary" className="gap-1">
                {route.runtime === 'browser' ? (
                  <MonitorIcon className="size-3" aria-hidden="true" />
                ) : (
                  <CloudIcon className="size-3" aria-hidden="true" />
                )}
                {t(route.runtime === 'browser' ? 'mode.local.label' : 'mode.server.label')}
              </Badge>
              {item.mode === 'auto' &&
                t(`routing.reasons.${decision.reason}`, {
                  threshold: formatBytes(routing.thresholdBytes, i18n.language),
                })}
            </p>
          )}
          {!route && !showBrowserBlocked && (
            <p className="text-amber-800 dark:text-amber-300">
              {t(`routing.reasons.${decision.reason}`)}
            </p>
          )}
          {steps.length > 1 && (
            <p className="text-muted-foreground">
              {t('routing.chain', {
                count: steps.length,
                path: [item.ext, ...steps.map((s) => s.to)]
                  .map((e) => formatName(t, e))
                  .join(' → '),
              })}
            </p>
          )}
          {[
            ...routing.warnings.map((w) => `warnings.${w}`),
            ...decision.warnings.map((w) => `routing.warnings.${w}`),
          ].map((key) => (
            <p key={key} className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t(key)}
            </p>
          ))}
        </div>
      )}

      {showBrowserBlocked && browserBlockedKey && (
        <ErrorMessage
          messageKey={browserBlockedKey}
          actions={
            hasServerRoute || (serverAvailable && routing.targets.length === 0) ? (
              <Button size="sm" variant="outline" onClick={() => setMode(item.id, 'server')}>
                {t('convert.useServer')}
              </Button>
            ) : undefined
          }
        />
      )}

      {canTrim && <TrimSection item={item} targets={routing.targets} disabled={busy} />}
      {canImageAi && <ImageAiSection item={item} disabled={busy} />}

      {route && item.targetExt && lastEngine && (
        <CardTabs item={item} targetExt={item.targetExt} disabled={busy}>
          <OptionsPanel
            idPrefix={`opt-${item.id}`}
            options={lastEngine.options}
            outputExt={item.targetExt}
            values={item.options}
            onChange={(key, value) => setOption(item.id, key, value)}
            disabled={busy}
          />
        </CardTabs>
      )}

      {route && item.status !== 'done' && (
        <div className="flex gap-2">
          {busy ? (
            <Button variant="outline" onClick={() => cancelConversion(item.id)}>
              <SquareIcon aria-hidden="true" />
              {t('convert.cancel')}
            </Button>
          ) : (
            <Button onClick={convert}>
              <WandSparklesIcon aria-hidden="true" />
              {t('convert.start')}
            </Button>
          )}
        </div>
      )}

      <ConversionStatus
        item={item}
        onRetry={convert}
        onDownloaded={() => removeAfterDownload([item.id])}
        onPreview={() => setPreview('result')}
        onRetryOnServer={hasServerRoute && item.mode !== 'server' ? retryOnServer : undefined}
      />

      {children}
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
