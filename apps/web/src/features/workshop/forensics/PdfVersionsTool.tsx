import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format-bytes';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { readVersions, type VersionInfo } from './pdf-checks';

/** Frühere Fassungen – the saved states hidden in an incrementally updated PDF. */
export function PdfVersionsTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [versions, setVersions] = useState<{ file: File; list: VersionInfo[] } | null>(null);
  const [failed, setFailed] = useState<File | null>(null);
  const current = versions && versions.file === file ? versions.list : null;

  useEffect(() => {
    if (!file) return;
    let active = true;
    void (async () => {
      try {
        const list = await readVersions(new Uint8Array(await file.arrayBuffer()));
        if (active) setVersions({ file, list });
        else for (const v of list) if (v.thumb) URL.revokeObjectURL(v.thumb);
      } catch (e) {
        console.error(e);
        if (active) setFailed(file);
      }
    })();
    return () => {
      active = false;
    };
  }, [file]);

  useEffect(
    () => () => {
      for (const v of current ?? []) if (v.thumb) URL.revokeObjectURL(v.thumb);
    },
    [current],
  );

  const base = file?.name.replace(/\.[^.]+$/, '') ?? 'document';
  const older = current ? current.length - 1 : 0;
  return (
    <div className="space-y-4">
      <HowItWorks trick="pdfversions" />
      <SingleFile file={file} onFile={setFile} />
      {file && failed === file && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.pdfversions.failed')}
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
            className={cn(
              'rounded-lg border p-3 text-sm',
              older > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-border',
            )}
            data-testid="pdfversions-verdict"
          >
            {current.length === 0
              ? t('workshop.pdfversions.none')
              : older > 0
                ? t('workshop.pdfversions.found', { count: older })
                : t('workshop.pdfversions.single')}
          </p>
          {older > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {current.map((v, i) => (
                <li key={v.number} className="flex gap-3 rounded-lg border p-3">
                  {v.thumb ? (
                    <img src={v.thumb} alt="" className="h-28 w-20 rounded border bg-white object-contain" />
                  ) : (
                    <div className="h-28 w-20 rounded border bg-muted" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1 text-sm">
                    <p className="font-medium">
                      {i === current.length - 1
                        ? t('workshop.pdfversions.latest')
                        : t('workshop.pdfversions.version', { n: v.number })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {v.pages === null
                        ? t('workshop.pdfversions.unreadable')
                        : t('workshop.pdfversions.pages', {
                            count: v.pages,
                            size: formatBytes(v.bytes.length, i18n.language),
                          })}
                    </p>
                    {i > 0 && v.pages !== null && (
                      <p className="text-xs">
                        {v.changed.length > 0
                          ? t('workshop.pdfversions.changed', { pages: v.changed.join(', ') })
                          : t('workshop.pdfversions.unchanged')}
                      </p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        saveBlob(
                          new Blob([v.bytes as Uint8Array<ArrayBuffer>], {
                            type: 'application/pdf',
                          }),
                          `${base}-version-${v.number}.pdf`,
                        )
                      }
                    >
                      <DownloadIcon aria-hidden="true" />
                      {t('workshop.pdfversions.download')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
