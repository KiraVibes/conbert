import { useMemo } from 'react';
import { WandSparklesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { listTargets, type TargetOption } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ViewIntro } from '@/components/ViewIntro';
import { runtimesFor, useAvailableEngines } from '@/engines/use-engines';
import { useSettings } from '@/features/settings/settings-store';
import { Dropzone } from './Dropzone';
import { FileCard } from './FileCard';
import { CompressCard } from './CompressCard';
import { useFiles, type FileItem, type FileTask } from './files-store';
import { FormatSelect } from './FormatSelect';
import { runAll } from './run-conversion';
import { DownloadAllButton } from './DownloadAllButton';
import { ApplyWorkflowButton } from '@/features/workflows/ApplyWorkflowButton';
import { PurposePicker } from './PurposePicker';

/** Targets every file in the list can be converted to (for "convert all to …"). */
function useCommonTargets(files: FileItem[]): TargetOption[] {
  const { engines, serverAvailable } = useAvailableEngines();
  return useMemo(() => {
    const ready = files.filter((f) => f.status !== 'detecting' && f.ext);
    if (ready.length === 0) return [];
    const lists = ready.map((f) =>
      listTargets(engines, f.ext, runtimesFor(f.mode, serverAvailable)),
    );
    const [first, ...rest] = lists;
    return (first ?? []).filter((target) =>
      rest.every((list) => list.some((x) => x.ext === target.ext)),
    );
  }, [files, engines, serverAvailable]);
}

function FileList({ files, task }: { files: FileItem[]; task: FileTask }) {
  const { t } = useTranslation();
  const setTarget = useFiles((s) => s.setTarget);
  const clear = useFiles((s) => s.clear);
  const thresholdMb = useSettings((s) => s.autoServerThresholdMb);
  const { engines, serverAvailable, serverHasGpu } = useAvailableEngines();
  const commonTargets = useCommonTargets(files);
  const busy = files.some((f) => f.status === 'converting');
  const pending = files.filter((f) => f.targetExt && (f.status === 'idle' || f.status === 'error'));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-end sm:justify-between">
        {task === 'compress' ? (
          <p className="text-sm text-muted-foreground">{t('compress.listHint')}</p>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="convert-all-target">{t('convert.allTo')}</Label>
            {commonTargets.length > 0 ? (
              <FormatSelect
                id="convert-all-target"
                targets={commonTargets}
                value={null}
                onChange={(ext) => files.forEach((f) => setTarget(f.id, ext))}
                disabled={busy}
              />
            ) : (
              <p id="convert-all-target" className="text-sm text-muted-foreground">
                {t('convert.noCommonTargets')}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t('files.count', { count: files.length })}
          </span>
          <Button variant="outline" size="sm" onClick={() => clear(task)} disabled={busy}>
            {t('files.clearAll')}
          </Button>
          <Button
            size="sm"
            disabled={busy || pending.length === 0}
            onClick={() =>
              void runAll(pending, engines, {
                serverAvailable,
                serverHasGpu,
                autoServerThresholdBytes: thresholdMb * 1024 * 1024,
              })
            }
          >
            <WandSparklesIcon aria-hidden="true" />
            {t(task === 'compress' ? 'compress.startAll' : 'convert.startAll')}
          </Button>
          <DownloadAllButton task={task} />
          <ApplyWorkflowButton files={files} disabled={busy} />
        </div>
      </div>
      <ul className="space-y-3">
        {files.map((item) => (
          <li key={item.id}>
            {task === 'compress' ? <CompressCard item={item} /> : <FileCard item={item} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConvertView({ task = 'convert' }: { task?: FileTask }) {
  const { t } = useTranslation();
  const files = useFiles((s) => s.files);
  const addFiles = useFiles((s) => s.addFiles);
  const defaultMode = useSettings((s) => s.defaultMode);
  const mine = useMemo(() => files.filter((f) => f.task === task), [files, task]);

  return (
    <div className="space-y-6">
      <ViewIntro help={task === 'compress' ? 'compress' : 'convert'}>
        {t(task === 'compress' ? 'compress.intro' : 'app.intro')}
      </ViewIntro>
      <Dropzone compact={mine.length > 0} onFiles={(f) => void addFiles(f, defaultMode, task)} />
      {task === 'convert' && <PurposePicker />}

      {mine.length > 0 && (
        <section aria-label={t('files.listLabel')}>
          <FileList files={mine} task={task} />
        </section>
      )}
    </div>
  );
}
