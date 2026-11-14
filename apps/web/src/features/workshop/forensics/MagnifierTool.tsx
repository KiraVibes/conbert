import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon } from 'lucide-react';
import { FORENSIC_FILTERS, type ForensicFilter } from '@conbert/core';
import { HelpTip } from '@/components/HelpTip';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { openForensics } from './forensics-worker';

const RANGE: Record<ForensicFilter, { min: number; max: number; start: number }> = {
  noise: { min: 2, max: 40, start: 12 },
  edges: { min: 2, max: 40, start: 10 },
  levels: { min: 0, max: 255, start: 128 },
};

/** Forensik-Lupe – filters that make edits visible. */
export function MagnifierTool() {
  const { t } = useTranslation();
  // One worker for the page: it keeps the decoded picture between slider moves.
  const worker = useRef<ReturnType<typeof openForensics> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [filter, setFilter] = useState<ForensicFilter>('noise');
  const [amounts, setAmounts] = useState(
    () =>
      Object.fromEntries(FORENSIC_FILTERS.map((f) => [f, RANGE[f].start])) as Record<
        ForensicFilter,
        number
      >,
  );
  const [shown, setShown] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const original = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const amount = amounts[filter];
  const key = file ? `${file.name}|${file.size}|${filter}|${amount}` : '';

  useEffect(
    () => () => {
      if (original) URL.revokeObjectURL(original);
    },
    [original],
  );

  useEffect(
    () => () => {
      worker.current?.stop();
      worker.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!file) return;
    let active = true;
    const timer = setTimeout(() => {
      worker.current ??= openForensics();
      worker.current.api
        .filter(file, filter, amount)
        .then((r) => {
          const c = canvas.current;
          if (!active || !c) return;
          c.width = r.width;
          c.height = r.height;
          c.getContext('2d')?.putImageData(new ImageData(r.pixels, r.width, r.height), 0, 0);
          setFailed(false);
          setShown(key);
        })
        .catch((e: unknown) => {
          console.error(e);
          if (active) setFailed(true);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [file, filter, amount, key]);

  return (
    <div className="space-y-4">
      <HowItWorks trick="magnifier" />
      <SingleFile file={file} onFile={setFile} />
      {file && (
        <div className="space-y-3">
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label={t('workshop.magnifier.filter')}
          >
            {FORENSIC_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm',
                  filter === f ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                )}
              >
                {t(`workshop.magnifier.filters.${f}.label`)}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {t(`workshop.magnifier.filters.${filter}.help`)}
          </p>
          <div className="max-w-md space-y-2">
            <Label className="flex items-center gap-1">
              {t(`workshop.magnifier.filters.${filter}.amount`, { value: amount })}
              <HelpTip
                helpKey={`workshop.magnifier.filters.${filter}.amountHelp`}
                labelKey={`workshop.magnifier.filters.${filter}.label`}
              />
            </Label>
            <Slider
              min={RANGE[filter].min}
              max={RANGE[filter].max}
              step={1}
              value={[amount]}
              onValueChange={([v]) =>
                setAmounts({ ...amounts, [filter]: v ?? RANGE[filter].start })
              }
              aria-label={t(`workshop.magnifier.filters.${filter}.label`)}
            />
          </div>
          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {t('workshop.magnifier.failed')}
            </p>
          )}
          {shown !== key && !failed && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              {t('workshop.magnifier.working')}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {original && (
              <img src={original} alt="" className="w-full rounded border object-contain" />
            )}
            <canvas
              ref={canvas}
              className="w-full rounded border bg-black"
              aria-label={t('workshop.magnifier.resultAlt')}
              data-testid="magnifier-canvas"
            />
          </div>
        </div>
      )}
    </div>
  );
}
