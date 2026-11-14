import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Comlink from 'comlink';
import { DownloadIcon, Loader2Icon } from 'lucide-react';
import type { CropRecovery } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { withForensics } from './forensics-worker';

const TONE: Record<CropRecovery['status'], string> = {
  'not-png': 'border-border',
  clean: 'border-emerald-500/40 bg-emerald-500/10',
  'trailer-only': 'border-amber-500/40 bg-amber-500/10',
  recovered: 'border-red-500/40 bg-red-500/10',
};

/** Abgeschnitten? – shows what a cropping tool left behind a PNG's end. */
export function CropCheckTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ file: File; r: CropRecovery } | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState<File | null>(null);
  const [showLost, setShowLost] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = result && result.file === file ? result.r : null;

  useEffect(() => {
    if (!file) return;
    let active = true;
    withForensics<CropRecovery>((api) =>
      api.recoverCrop(
        file,
        Comlink.proxy((share: number) => {
          if (active) setProgress(share);
        }),
      ),
    )
      .then((r) => {
        if (active) setResult({ file, r });
      })
      .catch((e: unknown) => {
        console.error(e);
        if (active) setFailed(file);
      });
    return () => {
      active = false;
    };
  }, [file]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || current?.status !== 'recovered') return;
    c.width = current.width;
    c.height = current.height;
    c.getContext('2d')?.putImageData(
      new ImageData(showLost ? current.marked : current.pixels, current.width, current.height),
      0,
      0,
    );
  }, [current, showLost]);

  function save() {
    canvas.current?.toBlob((blob) => {
      if (blob && file) saveBlob(blob, `${file.name.replace(/\.[^.]+$/, '')}-rest.png`);
    }, 'image/png');
  }

  return (
    <div className="space-y-4">
      <HowItWorks trick="cropcheck" />
      <SingleFile file={file} onFile={setFile} />
      {file && failed === file && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.cropcheck.failed')}
        </p>
      )}
      {file && !current && failed !== file && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span>{t('workshop.cropcheck.working')}</span>
          <Progress
            value={progress * 100}
            className="max-w-48 flex-1"
            aria-label={t('workshop.cropcheck.working')}
          />
        </div>
      )}
      {current && (
        <div className="space-y-3">
          <p
            className={cn('rounded-lg border p-3 text-sm', TONE[current.status])}
            data-testid="cropcheck-verdict"
          >
            {t(`workshop.cropcheck.verdict.${current.status}`, {
              bytes: 'trailerBytes' in current ? current.trailerBytes : 0,
              width: current.status === 'recovered' ? current.width : 0,
              height: current.status === 'recovered' ? current.height : 0,
            })}
          </p>
          {current.status === 'recovered' && (
            <>
              <canvas
                ref={canvas}
                className="max-h-[70vh] max-w-full rounded border"
                aria-label={t('workshop.cropcheck.restAlt')}
              />
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={showLost} onCheckedChange={setShowLost} />
                {t('workshop.cropcheck.showLost', {
                  percent: Math.round(current.guessed * 100),
                })}
              </label>
              <p className="text-xs text-muted-foreground">{t('workshop.cropcheck.magenta')}</p>
              <Button variant="outline" size="sm" onClick={save}>
                <DownloadIcon aria-hidden="true" />
                {t('workshop.cropcheck.download')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
