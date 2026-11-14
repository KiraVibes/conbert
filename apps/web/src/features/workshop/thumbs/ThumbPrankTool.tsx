import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon, WandSparklesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { makePrank, useObjectUrl } from './thumb-image';

/** Vorschau-Streich: the preview of a JPEG shows another picture than the file. */
export function ThumbPrankTool() {
  const { t } = useTranslation();
  const [real, setReal] = useState<File | null>(null);
  const [preview, setPreview] = useState<File | null>(null);
  const [result, setResult] = useState<{ blob: Blob; real: File; preview: File } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const realUrl = useObjectUrl(real);
  const previewUrl = useObjectUrl(preview);
  const current = result && result.real === real && result.preview === preview ? result : null;

  async function make() {
    if (!real || !preview) return;
    setBusy(true);
    setFailed(false);
    try {
      setResult({ blob: await makePrank(real, preview), real, preview });
    } catch (e) {
      console.error(e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const name = real ? `${real.name.replace(/\.[^.]+$/, '')}.jpg` : 'image.jpg';
  return (
    <div className="space-y-4">
      <HowItWorks trick="thumbprank" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('workshop.thumbprank.real')}</Label>
          <p className="text-xs text-muted-foreground">{t('workshop.thumbprank.realHint')}</p>
          <SingleFile file={real} onFile={setReal} />
          {realUrl && <img src={realUrl} alt="" className="max-h-48 rounded border" />}
        </div>
        <div className="space-y-2">
          <Label>{t('workshop.thumbprank.preview')}</Label>
          <p className="text-xs text-muted-foreground">{t('workshop.thumbprank.previewHint')}</p>
          <SingleFile file={preview} onFile={setPreview} />
          {previewUrl && <img src={previewUrl} alt="" className="max-h-48 rounded border" />}
        </div>
      </div>
      <Button onClick={() => void make()} disabled={!real || !preview || busy}>
        {busy ? (
          <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <WandSparklesIcon aria-hidden="true" />
        )}
        {t('workshop.thumbprank.make')}
      </Button>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.thumbprank.failed')}
        </p>
      )}
      {current && (
        <div className="space-y-2 rounded-lg border p-3" data-testid="thumbprank-result">
          <p className="text-sm">{t('workshop.thumbprank.done')}</p>
          <Button variant="outline" onClick={() => saveBlob(current.blob, name)}>
            <DownloadIcon aria-hidden="true" />
            {t('workshop.thumbprank.download', { name })}
          </Button>
          <p className="text-xs text-muted-foreground">{t('workshop.thumbprank.where')}</p>
        </div>
      )}
    </div>
  );
}
