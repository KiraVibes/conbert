import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon } from 'lucide-react';
import { jpegOrigin } from '@conbert/core';
import { HowItWorks, SingleFile } from '../SingleFile';
import { useFileJob } from './use-file-job';

/** JPG-Herkunft: where a JPEG probably came from (camera, editor, messenger). */
export function JpegOriginTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  // The header is enough – the tables come before the picture data.
  const { result, failed, busy } = useFileJob(file, 'jpeg', async (f) =>
    jpegOrigin(new Uint8Array(await f.slice(0, 2 * 1024 * 1024).arrayBuffer())),
  );

  return (
    <div className="space-y-4">
      <HowItWorks trick="jpegorigin" />
      <SingleFile file={file} onFile={setFile} />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.jpegorigin.failed')}
        </p>
      )}
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.reading')}
        </p>
      )}
      {file && !busy && !failed && !result && (
        <p className="rounded-lg border p-3 text-sm">{t('workshop.jpegorigin.notJpeg')}</p>
      )}
      {result && (
        <div className="space-y-3" data-testid="jpegorigin-result">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="font-medium">{t(`workshop.jpegorigin.origin.${result.origin}`)}</p>
            <p className="text-sm text-muted-foreground">
              {t(`workshop.jpegorigin.originHint.${result.origin}`)}
            </p>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {result.clues.map((c) => (
              <li key={c.key}>{t(`workshop.jpegorigin.clues.${c.key}`, c.values ?? {})}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('workshop.jpegorigin.limits')}</p>
        </div>
      )}
    </div>
  );
}
