import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrushCleaningIcon, Loader2Icon } from 'lucide-react';
import type { CleanOptions, OfficeSecrets } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { useFileJob } from './use-file-job';
import { withForensics } from './forensics-worker';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1 rounded-lg border p-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function count(r: OfficeSecrets): number {
  return (
    r.people.length +
    r.comments.length +
    r.changes.length +
    r.hiddenText.length +
    r.hiddenSheets.length +
    r.hiddenSlides.length +
    r.notes.length +
    r.paths.length +
    (r.thumbnail ? 1 : 0)
  );
}

/** Was verrät dein Dokument? – what Office files carry besides the visible text. */
export function DocSecretsTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<CleanOptions>({
    acceptChanges: true,
    removeComments: true,
    removeHidden: true,
  });
  const [busy, setBusy] = useState(false);
  const {
    result,
    failed,
    busy: reading,
  } = useFileJob(file, 'office', (f) => withForensics((api) => api.officeSecrets(f)));

  async function clean() {
    if (!file) return;
    setBusy(true);
    try {
      const bytes = await withForensics((api) => api.cleanOffice(file, options));
      const dot = file.name.lastIndexOf('.');
      const name =
        dot > 0 ? `${file.name.slice(0, dot)}-clean${file.name.slice(dot)}` : `${file.name}-clean`;
      saveBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: file.type }), name);
    } finally {
      setBusy(false);
    }
  }

  const word = result?.kind === 'word';
  const toggles: (keyof CleanOptions)[] = ['acceptChanges', 'removeComments', 'removeHidden'];
  return (
    <div className="space-y-4">
      <HowItWorks trick="docsecrets" />
      <SingleFile file={file} onFile={setFile} />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.docsecrets.failed')}
        </p>
      )}
      {reading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.reading')}
        </p>
      )}
      {result && (
        <div className="space-y-3" data-testid="docsecrets-result">
          <p
            className={cn(
              'rounded-lg border p-3 text-sm',
              count(result) > 0
                ? 'border-amber-500/40 bg-amber-500/10'
                : 'border-emerald-500/40 bg-emerald-500/10',
            )}
          >
            {count(result) > 0
              ? t('workshop.docsecrets.found', {
                  kind: t(`workshop.docsecrets.kinds.${result.kind}`),
                })
              : t('workshop.docsecrets.clean')}
          </p>
          {result.people.length > 0 && (
            <Section title={t('workshop.docsecrets.people')}>
              <p className="text-sm">{result.people.join(', ')}</p>
            </Section>
          )}
          {result.properties.length > 0 && (
            <Section title={t('workshop.docsecrets.properties')}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
                {result.properties.map((p) => (
                  <div key={p.key} className="contents">
                    <dt className="text-muted-foreground">
                      {t(`workshop.docsecrets.prop.${p.key}`)}
                    </dt>
                    <dd className="break-words">
                      {p.key === 'totalTime' && /^\d+$/.test(p.value)
                        ? t('workshop.docsecrets.minutes', { count: Number(p.value) })
                        : p.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
          {result.paths.length > 0 && (
            <Section title={t('workshop.docsecrets.paths')}>
              <ul className="font-mono text-xs break-all">
                {result.paths.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Section>
          )}
          {result.changes.length > 0 && (
            <Section title={t('workshop.docsecrets.changes', { count: result.changes.length })}>
              <ul className="space-y-1 text-sm">
                {result.changes.map((c, i) => (
                  <li key={i}>
                    <span
                      className={cn(
                        'mr-1 rounded px-1 text-xs',
                        c.type === 'del' ? 'bg-red-500/15 line-through' : 'bg-emerald-500/15',
                      )}
                    >
                      {t(`workshop.docsecrets.${c.type}`)}
                    </span>
                    „{c.text}“
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      – {c.author || '?'}
                      {c.date ? `, ${new Date(c.date).toLocaleString(i18n.language)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {result.comments.length > 0 && (
            <Section title={t('workshop.docsecrets.comments', { count: result.comments.length })}>
              <ul className="space-y-1 text-sm">
                {result.comments.map((c, i) => (
                  <li key={i}>
                    „{c.text}“
                    {c.author && (
                      <span className="text-xs text-muted-foreground"> – {c.author}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {result.hiddenText.length > 0 && (
            <Section title={t('workshop.docsecrets.hiddenText')}>
              <ul className="text-sm">
                {result.hiddenText.map((h, i) => (
                  <li key={i}>„{h}“</li>
                ))}
              </ul>
            </Section>
          )}
          {result.hiddenSheets.length > 0 && (
            <Section title={t('workshop.docsecrets.hiddenSheets')}>
              <p className="text-sm">{result.hiddenSheets.join(', ')}</p>
            </Section>
          )}
          {result.hiddenSlides.length > 0 && (
            <Section title={t('workshop.docsecrets.hiddenSlides')}>
              <p className="text-sm">{result.hiddenSlides.join(', ')}</p>
            </Section>
          )}
          {result.notes.length > 0 && (
            <Section title={t('workshop.docsecrets.notes')}>
              <ul className="space-y-1 text-sm">
                {result.notes.map((n) => (
                  <li key={n.slide}>
                    <span className="text-xs text-muted-foreground">
                      {t('workshop.docsecrets.slide', { n: n.slide })}:{' '}
                    </span>
                    {n.text}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {(result.thumbnail || result.sessions > 0) && (
            <Section title={t('workshop.docsecrets.more')}>
              <ul className="list-disc pl-5 text-sm">
                {result.thumbnail && <li>{t('workshop.docsecrets.thumbnail')}</li>}
                {result.sessions > 0 && (
                  <li>{t('workshop.docsecrets.sessions', { count: result.sessions })}</li>
                )}
              </ul>
            </Section>
          )}

          <section className="space-y-3 rounded-lg border p-3">
            <h3 className="font-medium">{t('workshop.docsecrets.cleanTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('workshop.docsecrets.cleanIntro')}</p>
            {word &&
              toggles.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={options[k]}
                    onCheckedChange={(v) => setOptions({ ...options, [k]: v })}
                  />
                  {t(`workshop.docsecrets.options.${k}`)}
                </label>
              ))}
            {!word && (
              <p className="text-xs text-muted-foreground">{t('workshop.docsecrets.onlyMeta')}</p>
            )}
            <Button onClick={() => void clean()} disabled={busy}>
              {busy ? (
                <Loader2Icon
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <BrushCleaningIcon aria-hidden="true" />
              )}
              {t('workshop.docsecrets.cleanButton')}
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
