import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { CopyButton } from '../CopyButton';
import { HowItWorks, SingleFile } from '../SingleFile';
import { checkRedactions, type RedactionReport } from './pdf-checks';

/** Schwärzung echt? – finds text that is only covered by a box. */
export function RedactCheckTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<{ file: File; r: RedactionReport } | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState<File | null>(null);
  const current = report && report.file === file ? report.r : null;

  useEffect(() => {
    if (!file) return;
    let active = true;
    void (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const r = await checkRedactions(bytes, (share) => {
          if (active) setProgress(share);
        });
        if (active) setReport({ file, r });
      } catch (e) {
        console.error(e);
        if (active) setFailed(file);
      }
    })();
    return () => {
      active = false;
    };
  }, [file]);

  const found = current?.covered ?? [];
  return (
    <div className="space-y-4">
      <HowItWorks trick="redactcheck" />
      <SingleFile file={file} onFile={setFile} />
      {file && failed === file && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.redactcheck.failed')}
        </p>
      )}
      {file && !current && failed !== file && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span>{t('workshop.redactcheck.working')}</span>
          <Progress
            value={progress * 100}
            className="max-w-48 flex-1"
            aria-label={t('workshop.redactcheck.working')}
          />
        </div>
      )}
      {current && (
        <div className="space-y-3">
          <p
            className={cn(
              'rounded-lg border p-3 text-sm',
              found.length > 0
                ? 'border-red-500/40 bg-red-500/10'
                : 'border-emerald-500/40 bg-emerald-500/10',
            )}
            data-testid="redactcheck-verdict"
          >
            {found.length > 0
              ? t('workshop.redactcheck.found', { count: found.length })
              : t('workshop.redactcheck.clean', { count: current.checked })}
          </p>
          {current.checked < current.pages && (
            <p className="text-xs text-muted-foreground">
              {t('workshop.redactcheck.limit', { checked: current.checked, pages: current.pages })}
            </p>
          )}
          {found.length > 0 && (
            <ul className="space-y-2">
              {found.map((f, i) => (
                <li key={i} className="space-y-1 rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    {t(`workshop.redactcheck.where.${f.color}`, { page: f.page })}
                  </p>
                  <div className="flex items-start gap-2">
                    <p className="flex-1 font-mono text-sm break-words">{f.text}</p>
                    <CopyButton text={f.text} label={t('workshop.redactcheck.copy')} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {found.length > 0 && (
            <p className="text-sm text-muted-foreground">{t('workshop.redactcheck.fix')}</p>
          )}
        </div>
      )}
    </div>
  );
}
