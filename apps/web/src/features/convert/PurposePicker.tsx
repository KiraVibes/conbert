import { useEffect } from 'react';
import { CheckCircle2Icon, InfoIcon, LightbulbIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PURPOSES, choosePurpose, listTargets, type PurposeId } from '@conbert/core';
import { runtimesFor, useAvailableEngines } from '@/engines/use-engines';
import { useView } from '@/lib/use-view';
import { cn } from '@/lib/utils';
import { useFiles, type PurposeNote } from './files-store';
import { usePurpose } from './purpose-store';

/** Applies the picked purpose to every file on the convert page, including ones added later. */
function useApplyPurpose(purpose: PurposeId | null) {
  const { t } = useTranslation();
  const [, navigate] = useView();
  const files = useFiles((s) => s.files);
  const { engines, serverAvailable } = useAvailableEngines();

  useEffect(() => {
    if (!purpose) return;
    const { applyPurpose, notePurpose } = useFiles.getState();
    let moved = 0;
    for (const f of files) {
      if (f.task !== 'convert' || f.status === 'detecting' || f.status === 'converting') continue;
      // Re-check files that didn't fit: the server's engines may have arrived since.
      const recheck = f.purpose?.id === purpose && f.purpose.state === 'notApplicable';
      if (f.purposeChecked === purpose && !recheck) continue;
      const reachable = listTargets(engines, f.ext, runtimesFor(f.mode, serverAvailable));
      const result = choosePurpose(purpose, f.ext, (ext) => reachable.some((r) => r.ext === ext));
      if (result.kind === 'choice') {
        applyPurpose(f.id, result.choice);
        if (result.choice.compress) moved += 1;
      } else if (!recheck || result.kind !== 'notApplicable') {
        notePurpose(f.id, {
          id: purpose,
          state: result.kind,
          ...(result.kind === 'alreadyFine' && { reasonKey: result.reasonKey }),
        });
      }
    }
    if (moved > 0) {
      toast(t('purposes.movedToCompress', { count: moved }), {
        action: { label: t('purposes.openCompress'), onClick: () => navigate('compress') },
      });
    }
  }, [purpose, files, engines, serverAvailable, t, navigate]);
}

/** "What do you need the file for?" – picks format and settings by purpose. */
export function PurposePicker() {
  const { t } = useTranslation();
  const purpose = usePurpose((s) => s.purpose);
  useApplyPurpose(purpose);
  const choose = (next: PurposeId | null) => usePurpose.setState({ purpose: next });

  const item = (id: PurposeId | null, label: string, summary?: string) => {
    const selected = purpose === id;
    return (
      <button
        key={id ?? 'none'}
        type="button"
        aria-pressed={selected}
        onClick={() => choose(id)}
        className={cn(
          'flex min-h-14 flex-col items-start justify-center rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
          selected ? 'border-primary bg-primary/10' : 'bg-background hover:bg-muted',
        )}
      >
        <span className="font-medium">{label}</span>
        {summary && <span className="text-xs text-muted-foreground">{summary}</span>}
      </button>
    );
  };

  return (
    <section
      aria-labelledby="purpose-title"
      data-tour="purpose"
      className="rounded-lg border bg-muted/30 p-3"
    >
      <h2 id="purpose-title" className="flex items-center gap-2 font-medium">
        <LightbulbIcon className="size-4 text-primary" aria-hidden="true" />
        {t('purposes.title')}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">{t('purposes.intro')}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PURPOSES.map((id) => item(id, t(`purposes.${id}.label`), t(`purposes.${id}.summary`)))}
        {item(null, t('purposes.none'))}
      </div>
    </section>
  );
}

/** One line on a file card: what the assistant chose and why. */
export function PurposeNoteLine({ note }: { note: PurposeNote }) {
  const { t } = useTranslation();
  if (note.state === 'notApplicable') {
    return (
      <p className="flex gap-2 text-sm text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t('purposes.notApplicable')}
      </p>
    );
  }
  const reason = note.reasonKey ? t(note.reasonKey) : '';
  return (
    <p className="flex gap-2 rounded-md bg-primary/5 px-2 py-1.5 text-sm">
      <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <span>
        <span className="font-medium">
          {t('purposes.chosen', { purpose: t(`purposes.${note.id}.label`) })}
        </span>{' '}
        <span className="text-muted-foreground">
          {note.state === 'alreadyFine' ? t('purposes.alreadyFine', { reason }) : reason}
        </span>
      </span>
    </p>
  );
}
