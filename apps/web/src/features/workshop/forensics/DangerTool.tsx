import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon, ShieldAlertIcon, ShieldCheckIcon, ShieldXIcon } from 'lucide-react';
import type { DangerLevel } from '@conbert/core';
import { detectFileType } from '@/lib/detect-type';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { useForensics } from './use-forensics';

const LOOK: Record<DangerLevel, { icon: typeof ShieldCheckIcon; tone: string }> = {
  safe: { icon: ShieldCheckIcon, tone: 'border-emerald-500/40 bg-emerald-500/10' },
  caution: { icon: ShieldAlertIcon, tone: 'border-amber-500/40 bg-amber-500/10' },
  danger: { icon: ShieldXIcon, tone: 'border-red-500/40 bg-red-500/10' },
};

/** Gefahren-Check: "Can I open this file safely?" */
export function DangerTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const { result, failed, busy } = useForensics(file, 'danger', async (api, f) => {
    const type = await detectFileType(f);
    return api.danger(f, f.name, type.ext);
  });

  const Look = result ? LOOK[result.level] : null;
  return (
    <div className="space-y-4">
      <HowItWorks trick="danger" />
      <SingleFile file={file} onFile={setFile} />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.danger.failed')}
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
      {result && Look && (
        <div className="space-y-3">
          <div
            role="status"
            className={cn('flex items-start gap-3 rounded-lg border p-4', Look.tone)}
            data-testid="danger-verdict"
          >
            <Look.icon className="mt-0.5 size-6 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">{t(`workshop.danger.level.${result.level}`)}</p>
              <p className="text-sm">{t(`workshop.danger.advice.${result.level}`)}</p>
            </div>
          </div>
          {result.findings.length > 0 && (
            <ul className="space-y-2">
              {result.findings.map((f, i) => (
                <li
                  key={`${f.key}-${i}`}
                  className={cn(
                    'rounded-lg border p-3 text-sm',
                    f.level === 'danger' ? 'border-red-500/30' : 'border-amber-500/30',
                  )}
                >
                  <span
                    className={cn(
                      'mr-2 inline-block rounded px-1.5 py-0.5 text-xs font-medium',
                      f.level === 'danger'
                        ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                    )}
                  >
                    {t(`workshop.danger.badge.${f.level}`)}
                  </span>
                  <span className="break-words">
                    {t(`workshop.danger.findings.${f.key}`, f.values ?? {})}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{t('workshop.danger.limits')}</p>
        </div>
      )}
    </div>
  );
}
