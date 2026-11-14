import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon, PrinterIcon } from 'lucide-react';
import type { AssembleResult } from '@conbert/core';
import { assembleCarrier } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Dropzone } from '@/features/convert/Dropzone';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { withForensics } from '../forensics/forensics-worker';
import { makePaperPdf, pdfPagesAsImages } from './paper';

function Tabs({ tab, onTab }: { tab: 'save' | 'restore'; onTab: (t: 'save' | 'restore') => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2" role="tablist">
      {(['save', 'restore'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={tab === m}
          onClick={() => onTab(m)}
          className={cn(
            'rounded-full border px-3 py-1 text-sm',
            tab === m ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
          )}
        >
          {t(`workshop.paper.tabs.${m}`)}
        </button>
      ))}
    </div>
  );
}

function Save() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ pages: number; codes: number } | null>(null);

  async function make() {
    if (!file) return;
    setProgress(0);
    setError(null);
    setDone(null);
    try {
      const r = await makePaperPdf(
        { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
        {
          title: t('workshop.paper.pdfTitle'),
          page: (n, of) => t('workshop.paper.pdfPage', { n, of }),
          restore: t('workshop.paper.pdfRestore'),
        },
        setProgress,
      );
      saveBlob(
        new Blob([r.pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
        `${file.name}-papier.pdf`,
      );
      setDone({ pages: r.pages, codes: r.codes });
    } catch (e) {
      console.error(e);
      setError(e instanceof RangeError ? t('workshop.paper.tooBig') : t('workshop.paper.failed'));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="space-y-3">
      <SingleFile file={file} onFile={setFile} />
      <Button onClick={() => void make()} disabled={!file || progress !== null}>
        {progress !== null ? (
          <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <PrinterIcon aria-hidden="true" />
        )}
        {t('workshop.paper.make')}
      </Button>
      {progress !== null && (
        <Progress
          value={progress * 100}
          className="max-w-sm"
          aria-label={t('workshop.paper.make')}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {done && (
        <p className="text-sm" data-testid="paper-done">
          {t('workshop.paper.done', { pages: done.pages, codes: done.codes })}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t('workshop.paper.sizeHint')}</p>
    </div>
  );
}

function Restore() {
  const { t } = useTranslation();
  const [pieces, setPieces] = useState<Uint8Array[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<AssembleResult | null>(null);

  async function add(files: File[]) {
    const found: Uint8Array[] = [...pieces];
    for (const f of files) {
      setBusy(f.name);
      const images =
        f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? await pdfPagesAsImages(f) : [f];
      for (const img of images) {
        try {
          found.push(...(await withForensics((api) => api.findQr(img))));
        } catch (e) {
          console.error(e);
        }
      }
    }
    setBusy(null);
    setPieces(found);
    setResult(assembleCarrier(found));
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('workshop.paper.restoreIntro')}</p>
      <Dropzone compact onFiles={(files) => void add(files)} />
      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.paper.reading', { name: busy })}
        </p>
      )}
      {result && !busy && (
        <div className="space-y-2" data-testid="paper-result">
          {result.ok ? (
            <>
              <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                {t('workshop.paper.restored', { name: result.file.name })}
              </p>
              <Button
                onClick={() =>
                  saveBlob(
                    new Blob([result.file.bytes as Uint8Array<ArrayBuffer>]),
                    result.file.name,
                  )
                }
              >
                <DownloadIcon aria-hidden="true" />
                {t('workshop.paper.download', { name: result.file.name })}
              </Button>
            </>
          ) : (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              {result.reason === 'missing'
                ? t('workshop.paper.missing', {
                    found: result.total - result.missing.length,
                    total: result.total,
                    list: result.missing
                      .slice(0, 40)
                      .map((i) => i + 1)
                      .join(', '),
                  })
                : t(`workshop.paper.${result.reason}`)}
            </p>
          )}
          {pieces.length > 0 && !result.ok && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPieces([]);
                setResult(null);
              }}
            >
              {t('workshop.paper.reset')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Papier-Backup – a file as printable QR codes, and back from photos or scans. */
export function PaperBackupTool() {
  const [tab, setTab] = useState<'save' | 'restore'>('save');
  return (
    <div className="space-y-4">
      <HowItWorks trick="paper" />
      <Tabs tab={tab} onTab={setTab} />
      {tab === 'save' ? <Save /> : <Restore />}
    </div>
  );
}
