import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon, TriangleAlertIcon } from 'lucide-react';
import { HelpTip } from '@/components/HelpTip';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { detectFileType } from '@/lib/detect-type';
import { HowItWorks, SingleFile } from '../SingleFile';
import { inspectWorker } from '../workshop-worker';

interface Analysis {
  key: string;
  url: string;
  average: number;
  peak: number;
}

/** Fälschungs-Detektor: error level analysis of a picture. */
export function ElaTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [quality, setQuality] = useState(90);
  const [amplify, setAmplify] = useState(15);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [isJpeg, setIsJpeg] = useState<{ file: File; jpeg: boolean } | null>(null);
  const key = file ? `${file.name}-${file.size}-${quality}-${amplify}` : '';
  const original = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(
    () => () => {
      if (original) URL.revokeObjectURL(original);
    },
    [original],
  );

  // The analysed picture's URL is freed when the next one arrives (or on leaving).
  useEffect(
    () => () => {
      if (analysis) URL.revokeObjectURL(analysis.url);
    },
    [analysis],
  );

  // A new analysis after a short pause (sliders move fast).
  useEffect(() => {
    if (!file) return;
    let active = true;
    const timer = setTimeout(() => {
      void detectFileType(file).then((t) => active && setIsJpeg({ file, jpeg: t.ext === 'jpg' }));
      inspectWorker
        .ela(file, quality / 100, amplify)
        .then((r) => {
          if (!active) return;
          setFailed(null);
          setAnalysis({ key, url: URL.createObjectURL(r.image), average: r.average, peak: r.peak });
        })
        .catch((e: unknown) => active && setFailed(String(e)));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [file, quality, amplify, key]);

  const current = analysis && analysis.key === key ? analysis : null;
  const notJpeg = isJpeg?.file === file && isJpeg.jpeg === false;

  return (
    <div className="space-y-4">
      <HowItWorks trick="ela" />
      <SingleFile file={file} onFile={setFile} />
      {notJpeg && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('workshop.ela.notJpeg')}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="flex items-center gap-1">
            {t('workshop.ela.quality', { value: quality })}
            <HelpTip helpKey="workshop.ela.qualityHelp" labelKey="workshop.ela.qualityLabel" />
          </Label>
          <Slider
            min={70}
            max={98}
            step={1}
            value={[quality]}
            onValueChange={([v]) => setQuality(v ?? 90)}
            aria-label={t('workshop.ela.qualityLabel')}
          />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-1">
            {t('workshop.ela.amplify', { value: amplify })}
            <HelpTip helpKey="workshop.ela.amplifyHelp" labelKey="workshop.ela.amplifyLabel" />
          </Label>
          <Slider
            min={5}
            max={50}
            step={1}
            value={[amplify]}
            onValueChange={([v]) => setAmplify(v ?? 15)}
            aria-label={t('workshop.ela.amplifyLabel')}
          />
        </div>
      </div>

      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.ela.failed')}
        </p>
      )}
      {file && !current && !failed && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.ela.working')}
        </p>
      )}
      {file && current && original && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <figure className="space-y-1">
              <img src={original} alt="" className="w-full rounded border object-contain" />
              <figcaption className="text-xs text-muted-foreground">
                {t('workshop.ela.original')}
              </figcaption>
            </figure>
            <figure className="space-y-1">
              <img
                src={current.url}
                alt={t('workshop.ela.resultAlt')}
                className="w-full rounded border bg-black object-contain"
              />
              <figcaption className="text-xs text-muted-foreground">
                {t('workshop.ela.result', {
                  average: current.average.toLocaleString(i18n.language),
                  peak: current.peak,
                })}
              </figcaption>
            </figure>
          </div>
          <section className="space-y-1 text-sm">
            <h3 className="font-medium">{t('workshop.ela.howToRead')}</h3>
            <p>{t('workshop.ela.read1')}</p>
            <p>{t('workshop.ela.read2')}</p>
            <p className="text-muted-foreground">{t('workshop.ela.limits')}</p>
          </section>
        </div>
      )}
    </div>
  );
}
