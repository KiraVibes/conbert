import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon } from 'lucide-react';
import { entropyLevel, type EntropyProfile } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/format-bytes';
import { readEntropy } from '../workshop-worker';

const HEIGHT = 200;
const PAD = { left: 36, right: 12, top: 12, bottom: 24 };

/** How "random" the file is, block by block – as a chart and a table. */
export function EntropyPanel({
  file,
  onShowOffset,
}: {
  file: File;
  onShowOffset: (offset: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState<EntropyProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const [width, setWidth] = useState(600);
  const box = useRef<HTMLDivElement>(null);
  const number = (v: number, digits = 2) =>
    new Intl.NumberFormat(i18n.language, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(v);

  useEffect(() => {
    // The panel is keyed by the file, so this runs once per file.
    let active = true;
    readEntropy(file)
      .then((p) => active && setProfile(p))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [file]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 600));
    observer.observe(el);
    return () => observer.disconnect();
  }, [profile, table]);

  if (failed)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('workshop.entropy.failed')}
      </p>
    );
  if (!profile) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        {t('workshop.entropy.loading')}
      </p>
    );
  }
  if (profile.blocks.length === 0)
    return <p className="text-sm text-muted-foreground">{t('workshop.entropy.empty')}</p>;

  const level = entropyLevel(profile.overall);
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const n = profile.blocks.length;
  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / 8) * plotH;
  const line = profile.blocks
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join('');
  const area = `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const range = (i: number) => {
    const from = i * profile.blockSize;
    const to = Math.min(file.size, from + profile.blockSize);
    return { from, to };
  };
  const pick = (clientX: number, rect: DOMRect) => {
    const ratio = (clientX - rect.left - PAD.left) / plotW;
    return Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
  };
  const hovered = hover !== null ? profile.blocks[hover] : undefined;

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-muted/50 p-4">
        <p className="text-sm text-muted-foreground">{t('workshop.entropy.overall')}</p>
        <p className="font-heading text-3xl font-semibold tabular-nums">
          {number(profile.overall)}{' '}
          <span className="text-base font-normal text-muted-foreground">
            {t('workshop.entropy.unit')}
          </span>
        </p>
        <p className="mt-1 text-sm">{t(`workshop.entropy.levels.${level}`)}</p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{t('workshop.entropy.chartTitle')}</h3>
        <Button variant="ghost" size="sm" onClick={() => setTable((v) => !v)} aria-pressed={table}>
          {table ? t('workshop.entropy.showChart') : t('workshop.entropy.showTable')}
        </Button>
      </div>

      {table ? (
        <div className="max-h-80 overflow-y-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="text-left">
                <th className="px-3 py-1.5 font-medium">{t('workshop.entropy.position')}</th>
                <th className="px-3 py-1.5 text-right font-medium">
                  {t('workshop.entropy.value')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {profile.blocks.map((v, i) => (
                <tr key={i}>
                  <td className="px-3 py-1 font-mono text-xs">
                    {formatBytes(range(i).from, i18n.language)} –{' '}
                    {formatBytes(range(i).to, i18n.language)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums">{number(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="relative">
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={t('workshop.entropy.chartLabel', { value: number(profile.overall) })}
            className="cursor-crosshair touch-none select-none"
            onPointerMove={(event) =>
              setHover(pick(event.clientX, event.currentTarget.getBoundingClientRect()))
            }
            onPointerLeave={() => setHover(null)}
            onClick={(event) =>
              onShowOffset(
                range(pick(event.clientX, event.currentTarget.getBoundingClientRect())).from,
              )
            }
          >
            {[0, 2, 4, 6, 8].map((v) => (
              <g key={v}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotW}
                  y1={y(v)}
                  y2={y(v)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y(v)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {v}
                </text>
              </g>
            ))}
            <path d={area} className="fill-primary/15" />
            <path
              d={line}
              className="stroke-primary"
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <text x={PAD.left} y={HEIGHT - 6} className="fill-muted-foreground text-[11px]">
              {t('workshop.entropy.start')}
            </text>
            <text
              x={PAD.left + plotW}
              y={HEIGHT - 6}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {formatBytes(file.size, i18n.language)}
            </text>
            {hover !== null && hovered !== undefined && (
              <g pointerEvents="none">
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  className="stroke-muted-foreground"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <circle
                  cx={x(hover)}
                  cy={y(hovered)}
                  r={4}
                  className="fill-primary stroke-card"
                  strokeWidth={2}
                />
              </g>
            )}
          </svg>
          {hover !== null && hovered !== undefined && (
            <div
              className="pointer-events-none absolute top-2 rounded-md border bg-popover px-2 py-1 text-xs shadow-sm"
              style={
                x(hover) > width / 2 ? { right: width - x(hover) + 8 } : { left: x(hover) + 8 }
              }
            >
              <p className="font-medium tabular-nums">
                {number(hovered)} {t('workshop.entropy.unit')}
              </p>
              <p className="text-muted-foreground">
                {formatBytes(range(hover).from, i18n.language)} –{' '}
                {formatBytes(range(hover).to, i18n.language)}
              </p>
            </div>
          )}
          <p className="mt-1 text-xs text-muted-foreground">{t('workshop.entropy.clickHint')}</p>
        </div>
      )}

      {profile.sampled && (
        <p className="text-sm text-muted-foreground">{t('workshop.entropy.sampled')}</p>
      )}

      <section className="space-y-1 text-sm">
        <h3 className="font-medium">{t('workshop.entropy.whyTitle')}</h3>
        <p>{t('workshop.entropy.why')}</p>
      </section>
    </div>
  );
}
