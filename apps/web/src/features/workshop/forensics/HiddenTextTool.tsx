import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { CopyButton } from '../CopyButton';
import { HowItWorks, SingleFile } from '../SingleFile';
import { findHiddenText, type HiddenTextReport } from './pdf-checks';

/** Versteckter Text – text in a PDF that machines read but people can't see. */
export function HiddenTextTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<{ file: File; r: HiddenTextReport } | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState<File | null>(null);
  const current = report && report.file === file ? report.r : null;

  useEffect(() => {
    if (!file) return;
    let active = true;
    void (async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const r = await findHiddenText(bytes, (share) => {
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

  const found = current?.found ?? [];
  const all = found.map((f) => f.text).join('\n');
  return (
    <div className="space-y-4">
      <HowItWorks trick="hiddentext" />
      <SingleFile file={file} onFile={setFile} />
      {file && failed === file && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.hiddentext.failed')}
        </p>
      )}
      {file && !current && failed !== file && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span>{t('workshop.hiddentext.working')}</span>
          <Progress
            value={progress * 100}
            className="max-w-48 flex-1"
            aria-label={t('workshop.hiddentext.working')}
          />
        </div>
      )}
      {current && (
        <div className="space-y-3">
          <p
            className={cn(
              'rounded-lg border p-3 text-sm',
              found.length > 0
                ? 'border-amber-500/40 bg-amber-500/10'
                : 'border-emerald-500/40 bg-emerald-500/10',
            )}
            data-testid="hiddentext-verdict"
          >
            {found.length > 0
              ? t('workshop.hiddentext.found', { count: found.length })
              : t('workshop.hiddentext.clean', { count: current.checked })}
          </p>
          {current.checked < current.pages && (
            <p className="text-xs text-muted-foreground">
              {t('workshop.hiddentext.limit', { checked: current.checked, pages: current.pages })}
            </p>
          )}
          {found.length > 0 && (
            <>
              <ul className="space-y-2">
                {found.map((f, i) => (
                  <li key={i} className="space-y-1 rounded-lg border p-3">
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{t(`workshop.hiddentext.kinds.${f.kind}`)}</Badge>
                      {t('workshop.hiddentext.page', { page: f.page })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t(`workshop.hiddentext.kindHelp.${f.kind}`)}
                    </p>
                    <div className="flex items-start gap-2">
                      <p className="flex-1 font-mono text-sm break-words">{f.text}</p>
                      <CopyButton text={f.text} label={t('workshop.hiddentext.copy')} />
                    </div>
                  </li>
                ))}
              </ul>
              <CopyButton text={all} label={t('workshop.hiddentext.copyAll')} />
            </>
          )}
          <p className="text-xs text-muted-foreground">{t('workshop.hiddentext.limits')}</p>
        </div>
      )}
    </div>
  );
}
