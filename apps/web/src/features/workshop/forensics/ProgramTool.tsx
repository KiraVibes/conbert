import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2Icon } from 'lucide-react';
import { formatBytes } from '@/lib/format-bytes';
import { HowItWorks, SingleFile } from '../SingleFile';
import { useForensics } from './use-forensics';

/** Programm-Inspektor: what a .exe / Linux / Mac program is, without running it. */
export function ProgramTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const { result, failed, busy } = useForensics(file, 'program', (api, f) => api.program(f));

  const yesNo = (v: boolean) => t(v ? 'workshop.program.yes' : 'workshop.program.no');
  const facts: [string, string][] = result
    ? [
        ['kind', t(`workshop.program.kinds.${result.kind}`)],
        ['format', t(`workshop.program.formats.${result.format}`)],
        ['arch', t('workshop.program.archValue', { arch: result.arch, bits: result.bits })],
        ...(result.subsystem
          ? ([['subsystem', t(`workshop.program.subsystems.${result.subsystem}`)]] as [
              string,
              string,
            ][])
          : []),
        [
          'built',
          result.built
            ? new Date(result.built).toLocaleString(i18n.language)
            : t('workshop.program.unknown'),
        ],
        ['signed', yesNo(result.signed)],
        [
          'packed',
          result.packed
            ? result.packed === 'unknown'
              ? t('workshop.program.packedUnknown')
              : result.packed
            : t('workshop.program.no'),
        ],
        ...(result.format === 'pe'
          ? ([['dotnet', yesNo(result.dotnet)]] as [string, string][])
          : []),
      ]
    : [];

  return (
    <div className="space-y-4">
      <HowItWorks trick="program" />
      <SingleFile file={file} onFile={setFile} />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.program.failed')}
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
        <p className="rounded-lg border p-3 text-sm" data-testid="program-none">
          {t('workshop.program.notProgram')}
        </p>
      )}
      {result && (
        <div className="space-y-4" data-testid="program-result">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border p-3 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{t(`workshop.program.facts.${k}`)}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {result.packed && (
            <p className="text-sm text-muted-foreground">{t('workshop.program.packedHint')}</p>
          )}
          <section className="space-y-2">
            <h3 className="font-medium">{t('workshop.program.abilities')}</h3>
            {result.abilities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  result.format === 'macho'
                    ? 'workshop.program.abilitiesMac'
                    : 'workshop.program.abilitiesNone',
                )}
              </p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {result.abilities.map((a) => (
                  <li key={a}>{t(`workshop.program.ability.${a}`)}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t('workshop.program.abilitiesHint')}</p>
          </section>
          {result.imports.length > 0 && (
            <details className="rounded-lg border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                {t('workshop.program.imports', { count: result.imports.length })}
              </summary>
              <ul className="mt-2 space-y-2 text-sm">
                {result.imports.map((imp, i) => (
                  <li key={i}>
                    <p className="font-mono">{imp.library}</p>
                    {imp.functions.length > 0 && (
                      <p className="font-mono text-xs break-words text-muted-foreground">
                        {imp.functions.slice(0, 400).join(', ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {result.sections.length > 0 && (
            <details className="rounded-lg border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                {t('workshop.program.sections', { count: result.sections.length })}
              </summary>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="font-normal">{t('workshop.program.sectionName')}</th>
                    <th className="font-normal">{t('workshop.program.sectionSize')}</th>
                    <th className="font-normal">{t('workshop.program.sectionEntropy')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.sections.map((s, i) => (
                    <tr key={i}>
                      <td className="font-mono">{s.name || '–'}</td>
                      <td>{formatBytes(s.size, i18n.language)}</td>
                      <td className={s.entropy > 7.2 ? 'text-amber-600 dark:text-amber-400' : ''}>
                        {s.entropy.toLocaleString(i18n.language, { maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
