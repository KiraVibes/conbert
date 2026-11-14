import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { withForensics } from './forensics-worker';
import { useFileJob } from './use-file-job';

/** Kopierte Bereiche – parts of a picture that were copied to another spot. */
export function CopyMoveTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { result, failed, busy } = useFileJob(file, 'copymove', (f) =>
    withForensics((api) => api.copyMove(f)),
  );

  // The picture with the found areas on top: blue = source, red = copy.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !result || !file) return;
    let active = true;
    void createImageBitmap(file).then((bitmap) => {
      if (!active) return;
      c.width = result.width;
      c.height = result.height;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0, result.width, result.height);
      bitmap.close();
      const img = ctx.getImageData(0, 0, result.width, result.height);
      for (let p = 0; p < result.mask.length; p++) {
        const m = result.mask[p];
        if (!m) continue;
        const o = p * 4;
        const [r, g, b] = m === 2 ? [255, 40, 40] : [40, 120, 255];
        img.data[o] = ((img.data[o] ?? 0) + r) / 2;
        img.data[o + 1] = ((img.data[o + 1] ?? 0) + g) / 2;
        img.data[o + 2] = ((img.data[o + 2] ?? 0) + b) / 2;
      }
      ctx.putImageData(img, 0, 0);
    });
    return () => {
      active = false;
    };
  }, [result, file]);

  const found = result ? result.regions.length > 0 : false;
  return (
    <div className="space-y-4">
      <HowItWorks trick="copymove" />
      <SingleFile file={file} onFile={setFile} />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.copymove.failed')}
        </p>
      )}
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.copymove.working')}
        </p>
      )}
      {result && (
        <div className="space-y-3">
          <p
            className={cn(
              'rounded-lg border p-3 text-sm',
              found ? 'border-red-500/40 bg-red-500/10' : 'border-emerald-500/40 bg-emerald-500/10',
            )}
            data-testid="copymove-verdict"
          >
            {found
              ? t('workshop.copymove.found', { count: result.regions.length })
              : t('workshop.copymove.clean')}
          </p>
          <canvas
            ref={canvas}
            className="max-h-[70vh] max-w-full rounded border"
            aria-label={t('workshop.copymove.mapAlt')}
          />
          {found && (
            <p className="text-xs text-muted-foreground">{t('workshop.copymove.legend')}</p>
          )}
          <p className="text-xs text-muted-foreground">{t('workshop.copymove.limits')}</p>
        </div>
      )}
    </div>
  );
}
