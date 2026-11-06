import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon } from 'lucide-react';
import { HelpTip } from '@/components/HelpTip';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

/** A labelled slider with its ⓘ explanation. */
export function FunSlider({
  label,
  labelKey,
  helpKey,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  labelKey: string;
  helpKey: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1">
        {label}
        <HelpTip helpKey={helpKey} labelKey={labelKey} />
      </Label>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v ?? value)}
        aria-label={t(labelKey)}
      />
    </div>
  );
}

/** The picture before and after, side by side (stacked on phones). */
export function BeforeAfter({
  original,
  result,
  working,
  failed,
  failedText,
  pixelated = false,
  resultAlt,
  children,
}: {
  original: File;
  result: string | null;
  working: boolean;
  failed: boolean;
  failedText: string;
  pixelated?: boolean;
  resultAlt: string;
  /** Buttons under the result. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  // Created in the effect (not in useMemo), so a remount never shows a freed address.
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(original);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL must live exactly as long as the effect
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [original]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <figure className="space-y-1">
          {source && (
            <img
              src={source}
              alt=""
              className="max-h-[60vh] w-full rounded border object-contain"
            />
          )}
          <figcaption className="text-xs text-muted-foreground">
            {t('workshop.fun.before')}
          </figcaption>
        </figure>
        <figure className="relative space-y-1">
          {result ? (
            <img
              src={result}
              alt={resultAlt}
              className={cn(
                'max-h-[60vh] w-full rounded border object-contain transition-opacity',
                pixelated && '[image-rendering:pixelated]',
                working && 'opacity-60',
              )}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded border bg-muted/40" />
          )}
          {working && (
            <span className="absolute top-2 right-2 flex items-center gap-1.5 rounded bg-background/90 px-2 py-1 text-xs">
              <Loader2Icon
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              {t('workshop.fun.working')}
            </span>
          )}
          <figcaption className="text-xs text-muted-foreground">
            {t('workshop.fun.after')}
          </figcaption>
        </figure>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {failedText}
        </p>
      )}
      {result && children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
