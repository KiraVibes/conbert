import { useTranslation } from 'react-i18next';
import {
  CircleCheckIcon,
  DownloadIcon,
  FileQuestionIcon,
  ListPlusIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { ZIP_BASED, getFormat, type FileIdentity, type FileStructure } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { formatName } from '@/features/convert/format-text';
import { useFiles } from '@/features/convert/files-store';
import { useSettings } from '@/features/settings/settings-store';
import { formatBytes } from '@/lib/format-bytes';
import { useView, useWorkshopTrick } from '@/lib/use-view';
import { cn } from '@/lib/utils';
import { partName, saveResult } from '../detective/save-part';
import { hex, printable, saveBlob } from '../save-blob';
import { carvePart } from '../workshop-worker';

/** "Was ist diese Datei wirklich?" – the verdict, the telltale bytes and a repair. */
export function IdentifyPanel({
  file,
  identity,
  structure,
  head,
  onShowOffset,
}: {
  file: File;
  identity: FileIdentity;
  structure: FileStructure | null;
  head: Uint8Array;
  onShowOffset: (offset: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const [, navigate] = useView();
  const [, openTrick] = useWorkshopTrick();
  const addFiles = useFiles((s) => s.addFiles);
  const defaultMode = useSettings((s) => s.defaultMode);
  const name = (ext: string | null) => (ext ? formatName(t, ext) : '');
  const real = name(identity.realExt);
  const claimed = name(identity.nameExt);
  const good = identity.verdict === 'match' || identity.verdict === 'text';
  const info = identity.realExt
    ? getFormat(identity.realExt)
    : identity.nameExt
      ? getFormat(identity.nameExt)
      : undefined;
  const sig = identity.signature;
  const shown = head.subarray(0, 16);

  const verdictText = {
    match: t('workshop.identify.match', { format: real }),
    mismatch: t('workshop.identify.mismatch', { claimed, real }),
    'missing-ext': t('workshop.identify.missingExt', { real }),
    text: t('workshop.identify.text', {
      encoding: identity.text ? t(`workshop.identify.encodings.${identity.text}`) : '',
    }),
    'text-mismatch': t('workshop.identify.textMismatch', { claimed }),
    unknown: t('workshop.identify.unknown'),
  }[identity.verdict];
  const hintKey = {
    match: 'workshop.identify.matchHint',
    mismatch: 'workshop.identify.mismatchHint',
    'missing-ext': 'workshop.identify.missingExtHint',
    text: 'workshop.identify.textHint',
    'text-mismatch': 'workshop.identify.textMismatchHint',
    unknown: 'workshop.identify.unknownHint',
  }[identity.verdict];
  const Icon = good
    ? CircleCheckIcon
    : identity.verdict === 'unknown'
      ? FileQuestionIcon
      : TriangleAlertIcon;

  const fixed = identity.suggestedName
    ? new File([file], identity.suggestedName, { type: file.type })
    : null;

  return (
    <div className="space-y-5">
      <div
        role="status"
        className={cn(
          'flex items-start gap-3 rounded-lg border p-4',
          good
            ? 'border-emerald-600/30 bg-emerald-600/5'
            : identity.verdict === 'unknown'
              ? 'bg-muted/40'
              : 'border-amber-500/40 bg-amber-500/10',
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            'mt-0.5 size-5 shrink-0',
            good
              ? 'text-emerald-600 dark:text-emerald-400'
              : identity.verdict === 'unknown'
                ? 'text-muted-foreground'
                : 'text-amber-600 dark:text-amber-400',
          )}
        />
        <div className="space-y-1">
          <p className="font-medium">{verdictText}</p>
          <p className="text-sm text-muted-foreground">{t(hintKey)}</p>
        </div>
      </div>

      {fixed && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => saveBlob(fixed, fixed.name)}>
            <DownloadIcon aria-hidden="true" />
            {t('workshop.identify.saveFixed', { name: fixed.name })}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void addFiles([fixed], defaultMode);
              navigate('home');
            }}
          >
            <ListPlusIcon aria-hidden="true" />
            {t('workshop.identify.addFixed')}
          </Button>
        </div>
      )}

      {shown.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-medium">{t('workshop.identify.bytesTitle')}</h3>
          <div className="overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-sm">
            <div className="flex gap-1.5">
              {[...shown].map((b, i) => {
                const hit = sig !== null && i >= sig.offset && i < sig.offset + sig.length;
                return (
                  <span key={i} className="flex flex-col items-center">
                    <span
                      className={cn(
                        'rounded px-0.5',
                        hit &&
                          'bg-violet-500/20 font-semibold text-violet-700 dark:text-violet-300',
                      )}
                    >
                      {hex(b, 2)}
                    </span>
                    <span className="text-xs text-muted-foreground">{printable(b)}</span>
                  </span>
                );
              })}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {sig
              ? t('workshop.identify.signatureOf', {
                  from: sig.offset,
                  to: sig.offset + sig.length - 1,
                  format: name(sig.ext),
                })
              : identity.text
                ? t('workshop.identify.noSignatureText')
                : t('workshop.identify.noSignature')}
          </p>
          {sig && sig.offset >= 16 && (
            <p className="text-sm text-muted-foreground">
              {t('workshop.identify.signatureFar', { offset: sig.offset })}
            </p>
          )}
        </section>
      )}

      {identity.realExt === 'age' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
          <p className="flex-1">{t('workshop.identify.ageHint')}</p>
          <Button size="sm" variant="outline" onClick={() => openTrick('vault')}>
            {t('workshop.identify.openVault')}
          </Button>
        </div>
      )}

      {identity.realExt && identity.realExt !== 'zip' && ZIP_BASED.has(identity.realExt) && (
        <p className="text-sm">{t('workshop.identify.zipInside', { format: real })}</p>
      )}

      {structure?.appendedAt != null && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-orange-500/40 bg-orange-500/10 p-3 text-sm">
          <p className="flex-1">
            {t('workshop.identify.appended', {
              size: formatBytes(file.size - structure.appendedAt, i18n.language),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                const at = structure.appendedAt ?? 0;
                const tail = structure.regions.at(-1);
                const format =
                  typeof tail?.values?.['format'] === 'string' ? tail.values['format'] : null;
                void carvePart(file, at, file.size - at, format).then((r) =>
                  saveResult(r, partName(file.name, at, format), t),
                );
              }}
            >
              <DownloadIcon aria-hidden="true" />
              {t('workshop.identify.extractAppended')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onShowOffset(structure.appendedAt ?? 0)}
            >
              {t('workshop.identify.showAppended')}
            </Button>
          </div>
        </div>
      )}

      {info && (
        <section className="space-y-1 text-sm">
          <h3 className="font-medium">
            {t('workshop.identify.aboutFormat', { format: t(info.nameKey) })}
          </h3>
          <p>{t(info.summaryKey)}</p>
          <p className="text-muted-foreground">
            {t('workshop.identify.goodFor')}: {t(info.goodForKey)}
          </p>
          {info.openWithKey && (
            <p className="text-muted-foreground">
              {t('workshop.identify.openWith')}: {t(info.openWithKey)}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
