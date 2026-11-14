import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { checkThumb, useObjectUrl, type ThumbCheck } from './thumb-image';

const TONE = {
  none: 'border-border',
  same: 'border-emerald-500/40 bg-emerald-500/10',
  cropped: 'border-amber-500/40 bg-amber-500/10',
  different: 'border-red-500/40 bg-red-500/10',
} as const;

/** Vorschau-Prüfer: does the hidden EXIF preview show the same as the picture? */
export function ThumbCheckTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<{ file: File; result: ThumbCheck } | null>(null);
  const [failed, setFailed] = useState<File | null>(null);
  const current = check && check.file === file ? check.result : null;
  const fileUrl = useObjectUrl(file);
  const thumbUrl = useObjectUrl(current?.thumb ?? null);

  useEffect(() => {
    if (!file) return;
    let active = true;
    checkThumb(file)
      .then((result) => {
        if (active) setCheck({ file, result });
      })
      .catch((e: unknown) => {
        console.error(e);
        if (active) setFailed(file);
      });
    return () => {
      active = false;
    };
  }, [file]);

  const percent = current ? Math.round(current.changed * 100).toLocaleString(i18n.language) : '0';
  const base = file?.name.replace(/\.[^.]+$/, '') ?? 'image';
  return (
    <div className="space-y-4">
      <HowItWorks trick="thumbcheck" />
      <SingleFile file={file} onFile={setFile} />
      {file && failed === file && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.thumbcheck.failed')}
        </p>
      )}
      {file && !current && failed !== file && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.reading')}
        </p>
      )}
      {current && (
        <div className="space-y-3">
          <p
            className={cn('rounded-lg border p-3 text-sm', TONE[current.verdict])}
            data-testid="thumbcheck-verdict"
          >
            {t(`workshop.thumbcheck.verdict.${current.verdict}`, { percent })}
          </p>
          {thumbUrl && fileUrl && (
            <div className="grid gap-3 sm:grid-cols-2">
              <figure className="space-y-1">
                <img src={fileUrl} alt="" className="w-full rounded border object-contain" />
                <figcaption className="text-xs text-muted-foreground">
                  {t('workshop.thumbcheck.picture')}
                </figcaption>
              </figure>
              <figure className="space-y-1">
                <img
                  src={thumbUrl}
                  alt={t('workshop.thumbcheck.previewAlt')}
                  className="w-full rounded border object-contain"
                />
                <figcaption className="text-xs text-muted-foreground">
                  {t('workshop.thumbcheck.preview')}
                </figcaption>
              </figure>
            </div>
          )}
          {current.thumb && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => current.thumb && saveBlob(current.thumb, `${base}-preview.jpg`)}
            >
              <DownloadIcon aria-hidden="true" />
              {t('workshop.thumbcheck.download')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
