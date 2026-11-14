import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Comlink from 'comlink';
import { Loader2Icon } from 'lucide-react';
import type { CutReport } from '@conbert/core';
import { cn } from '@/lib/utils';
import { decodeSound } from '../audio-convert';
import { HowItWorks, SingleFile } from '../SingleFile';
import { useObjectUrl } from '../thumbs/thumb-image';
import { withForensics } from './forensics-worker';
import { useFileJob } from './use-file-job';

/** Longer recordings are checked up to here (memory). */
const MAX_SECONDS = 20 * 60;

const COLORS = { noise: 'stroke-sky-500', hum: 'stroke-amber-500' } as const;

function Chart({ report, onSeek }: { report: CutReport; onSeek: (t: number) => void }) {
  const { t } = useTranslation();
  const W = 800;
  const H = 160;
  const lines = useMemo(() => {
    const all = [...report.noise, ...report.hum.filter((v): v is number => v !== null)];
    const lo = Math.min(...all);
    const hi = Math.max(...all, lo + 1);
    const y = (v: number) => H - 8 - ((v - lo) / (hi - lo)) * (H - 16);
    const x = (i: number) => (i * report.step * W) / Math.max(report.duration, 0.001);
    const path = (values: (number | null)[]) =>
      values
        .map((v, i) =>
          v === null ? '' : `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
        )
        .join(' ');
    return { noise: path(report.noise), hum: report.humFrequency ? path(report.hum) : '' };
  }, [report]);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-40 w-full rounded border bg-muted/30"
      role="img"
      aria-label={t('workshop.audiocuts.chartAlt')}
    >
      <path d={lines.noise} fill="none" className={cn('stroke-2', COLORS.noise)} />
      {lines.hum && <path d={lines.hum} fill="none" className={cn('stroke-2', COLORS.hum)} />}
      {report.suspects.map((s, i) => {
        const x = (s.time / report.duration) * W;
        return (
          <line
            key={i}
            x1={x}
            x2={x}
            y1={0}
            y2={H}
            className="cursor-pointer stroke-red-500"
            strokeWidth={2}
            onClick={() => onSeek(s.time)}
          />
        );
      })}
    </svg>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** Schnitt-Detektor – where a recording was probably cut. */
export function AudioCutsTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const url = useObjectUrl(file);
  const { result, failed, busy } = useFileJob(file, 'cuts', async (f) => {
    const sound = await decodeSound(f);
    const samples = sound.samples.subarray(0, MAX_SECONDS * sound.sampleRate).slice();
    // The samples go to the worker (and are gone here) – remember the length first.
    const cut = sound.samples.length > samples.length;
    const report = await withForensics((api) =>
      api.cuts(Comlink.transfer(samples, [samples.buffer]), sound.sampleRate),
    );
    return { report, cut };
  });

  const seek = (time: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, time - 1);
    void a.play();
  };

  const report = result?.report;
  return (
    <div className="space-y-4">
      <HowItWorks trick="audiocuts" />
      <SingleFile file={file} onFile={setFile} />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.audiocuts.failed')}
        </p>
      )}
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.audiocuts.working')}
        </p>
      )}
      {report && (
        <div className="space-y-3" data-testid="audiocuts-result">
          <p
            className={cn(
              'rounded-lg border p-3 text-sm',
              report.suspects.length > 0
                ? 'border-amber-500/40 bg-amber-500/10'
                : 'border-emerald-500/40 bg-emerald-500/10',
            )}
          >
            {report.suspects.length > 0
              ? t('workshop.audiocuts.found', { count: report.suspects.length })
              : t('workshop.audiocuts.clean')}
          </p>
          {url && <audio ref={audio} src={url} controls className="w-full" />}
          <Chart report={report} onSeek={seek} />
          <p className="text-xs text-muted-foreground">
            {report.humFrequency
              ? t('workshop.audiocuts.legendHum', { hz: report.humFrequency })
              : t('workshop.audiocuts.legendNoHum')}
          </p>
          {report.suspects.length > 0 && (
            <ul className="space-y-1 text-sm">
              {report.suspects.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="mr-2 rounded border px-2 py-0.5 font-mono text-xs hover:bg-muted"
                    onClick={() => seek(s.time)}
                  >
                    {clock(s.time)}
                  </button>
                  {t(`workshop.audiocuts.reason.${s.reason}`, { strength: s.strength })}
                </li>
              ))}
            </ul>
          )}
          {result.cut && (
            <p className="text-xs text-muted-foreground">{t('workshop.audiocuts.cutShort')}</p>
          )}
          <p className="text-xs text-muted-foreground">{t('workshop.audiocuts.limits')}</p>
        </div>
      )}
    </div>
  );
}
