import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { buildTimeline } from '@conbert/core';
import { detectFileType } from '@/lib/detect-type';
import { readMetadata } from '@/features/metadata/metadata-engine';
import { HowItWorks, SingleFile } from '../SingleFile';
import { useFileJob } from './use-file-job';

/** Zeitleiste – every date a file carries, in order, with what doesn't fit. */
export function TimelineTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const { result, failed, busy } = useFileJob(file, 'timeline', async (f) => {
    const type = await detectFileType(f);
    const tags = await readMetadata(f, type.ext ?? f.name.split('.').pop() ?? 'bin');
    return buildTimeline(tags, f.lastModified || null);
  });

  // Times without a zone are read as local time – as the camera showed them.
  const format = (iso: string) => new Date(iso).toLocaleString(i18n.language);

  return (
    <div className="space-y-4">
      <HowItWorks trick="timeline" />
      <SingleFile file={file} onFile={setFile} />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.timeline.failed')}
        </p>
      )}
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.timeline.working')}
        </p>
      )}
      {result && (
        <div className="space-y-3" data-testid="timeline-result">
          {result.warnings.length > 0 && (
            <ul className="space-y-2">
              {result.warnings.map((w) => (
                <li
                  key={w.key}
                  className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                >
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t(`workshop.timeline.warnings.${w.key}`, w.values ?? {})}
                </li>
              ))}
            </ul>
          )}
          {result.events.length <= 1 ? (
            <p className="rounded-lg border p-3 text-sm">{t('workshop.timeline.none')}</p>
          ) : (
            <ol className="relative space-y-3 border-l pl-5">
              {result.events.map((e, i) => (
                <li key={`${e.source}-${i}`} className="relative">
                  <span
                    className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium">
                    {format(e.when)}
                    {!e.zoned && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {t('workshop.timeline.noZone')}
                      </span>
                    )}
                  </p>
                  <p className="text-sm">{t(`workshop.timeline.labels.${e.label}`)}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {e.source === 'file' ? t('workshop.timeline.fileSystem') : e.source}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
