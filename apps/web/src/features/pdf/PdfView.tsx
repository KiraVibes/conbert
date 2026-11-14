import { useMemo, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DownloadIcon,
  EraserIcon,
  FileTextIcon,
  Loader2Icon,
  RotateCcwIcon,
  RotateCwIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConversionError, isAbortError } from '@conbert/core';
import { convertOnServer } from '@/engines/server-convert';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { ViewIntro } from '@/components/ViewIntro';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dropzone } from '@/features/convert/Dropzone';
import { SaveToStorageButton } from '@/features/storage/StorageButtons';
import { formatBytes } from '@/lib/format-bytes';
import { createZip, saveBlob, zipFileName } from '@/lib/zip';
import { usePageThumb } from './page-thumbs';
import { addWatermark, flattenPage } from './pdf-finish';
import { pdfPassword } from './pdf-password';
import { LockedFiles, ProtectSection, RedactDialog, type ProtectSettings } from './PdfExtras';
import {
  baseName,
  buildPdf,
  groupLabel,
  parseRanges,
  splitPdf,
  type OutputFile,
  type PageRef,
} from './pdf-ops';
import { usePdfTool } from './pdf-store';
import { OcrSection } from './OcrSection';
import { useOcrEngine } from './use-ocr-engine';

type OutputMode = 'merge' | 'selected' | 'each' | 'ranges';
const MODES: readonly OutputMode[] = ['merge', 'selected', 'each', 'ranges'];

function PageTile({ page, position, total }: { page: PageRef; position: number; total: number }) {
  const { t } = useTranslation();
  const source = usePdfTool((s) => s.sources.find((x) => x.id === page.sourceId));
  const selected = usePdfTool((s) => s.selected.has(page.id));
  const { move, rotate, remove, toggle } = usePdfTool.getState();
  const thumb = usePageThumb(source, page.index);
  const [dragOver, setDragOver] = useState(false);
  const [redacting, setRedacting] = useState(false);
  const blackBoxes = page.redactions?.length ?? 0;
  const sideways = page.rotation === 90 || page.rotation === 270;
  const label = t('pdf.pageLabel', {
    position,
    name: source?.name ?? '',
    page: page.index + 1,
  });

  return (
    <Card
      className={`gap-2 p-2 ${selected ? 'ring-2 ring-primary' : ''} ${dragOver ? 'border-primary' : ''}`}
      data-testid="pdf-page"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/x-conbert-page', page.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/x-conbert-page')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const id = e.dataTransfer.getData('text/x-conbert-page');
        if (id && id !== page.id) move(id, position - 1);
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <label className="flex items-center gap-1.5 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={selected}
            onChange={() => toggle(page.id)}
            aria-label={t('pdf.select', { label })}
          />
          {position}
        </label>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => remove([page.id])}
          aria-label={t('pdf.removeNamed', { label })}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded border bg-muted">
        {thumb ? (
          <img
            src={thumb}
            alt={label}
            className="max-h-full max-w-full object-contain transition-transform"
            style={{ transform: `rotate(${page.rotation}deg) scale(${sideways ? 0.75 : 1})` }}
            draggable={false}
          />
        ) : (
          <Loader2Icon
            className="size-5 animate-spin text-muted-foreground"
            aria-label={t('pdf.drawing')}
          />
        )}
      </div>
      <p className="truncate text-xs text-muted-foreground" title={source?.name}>
        {t('pdf.fromFile', { name: source?.name ?? '', page: page.index + 1 })}
      </p>
      <Button
        size="sm"
        variant={blackBoxes > 0 ? 'secondary' : 'ghost'}
        className="h-7 justify-start px-2 text-xs"
        disabled={!source}
        onClick={() => setRedacting(true)}
        aria-label={t('pdf.redact.openNamed', { label })}
      >
        <EraserIcon aria-hidden="true" />
        {blackBoxes > 0 ? t('pdf.redact.count', { count: blackBoxes }) : t('pdf.redact.open')}
      </Button>
      {source && (
        <RedactDialog page={page} source={source} open={redacting} onOpenChange={setRedacting} />
      )}
      <div className="flex justify-between">
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          disabled={position === 1}
          onClick={() => move(page.id, position - 2)}
          aria-label={t('pdf.moveLeft', { label })}
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => rotate([page.id], -90)}
          aria-label={t('pdf.rotateLeftNamed', { label })}
        >
          <RotateCcwIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => rotate([page.id], 90)}
          aria-label={t('pdf.rotateRightNamed', { label })}
        >
          <RotateCwIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          disabled={position === total}
          onClick={() => move(page.id, position)}
          aria-label={t('pdf.moveRight', { label })}
        >
          <ArrowRightIcon aria-hidden="true" />
        </Button>
      </div>
    </Card>
  );
}

interface Progress {
  done: number;
  total: number;
  /** While the server recognises text: percent of the current file. */
  ocrPercent?: number;
  /** While the server puts the password on. */
  locking?: boolean;
}

interface BuildError {
  messageKey: string;
  details?: string;
}

function OutputPanel() {
  const { t, i18n } = useTranslation();
  const sources = usePdfTool((s) => s.sources);
  const pages = usePdfTool((s) => s.pages);
  const selected = usePdfTool((s) => s.selected);
  const [mode, setMode] = useState<OutputMode>('merge');
  const [ranges, setRanges] = useState('');
  const [busy, setBusy] = useState<Progress | null>(null);
  const ocrEngine = useOcrEngine();
  const [ocrOn, setOcrOn] = useState(false);
  const [ocrOptions, setOcrOptions] = useState<Record<string, unknown>>({});
  const ocr = ocrOn && ocrEngine !== null;
  const [protect, setProtect] = useState<ProtectSettings>({
    watermark: '',
    position: 'diagonal',
    password: '',
  });
  const [droppedChars, setDroppedChars] = useState(false);
  const [controller, setController] = useState<AbortController | null>(null);
  // Any change to the pages makes an old result outdated: results remember
  // the inputs they were built from and only show while those are current.
  const inputs = useMemo(
    () => ({ pages, selected, mode, ranges, ocr, ocrOptions, protect }),
    [pages, selected, mode, ranges, ocr, ocrOptions, protect],
  );
  const [built, setResult] = useState<{ files: OutputFile[]; inputs: object } | null>(null);
  const [failed, setError] = useState<(BuildError & { inputs: object }) | null>(null);
  const result = built?.inputs === inputs ? built.files : null;
  const error = failed?.inputs === inputs ? failed : null;
  const [zipping, setZipping] = useState(false);

  const first = sources[0];
  const name = sources.length === 1 && first ? baseName(first.name) : t('pdf.fileName.merged');
  const groups = mode === 'ranges' ? parseRanges(ranges, pages.length) : null;
  const rangesInvalid = mode === 'ranges' && ranges.trim() !== '' && groups === null;
  const canBuild =
    pages.length > 0 &&
    busy === null &&
    (mode !== 'selected' || selected.size > 0) &&
    (mode !== 'ranges' || groups !== null);

  const build = async () => {
    setBusy({ done: 0, total: 1 });
    setError(null);
    const abort = new AbortController();
    setController(abort);
    const progress = (done: number, total: number) => setBusy({ done, total });
    try {
      let files: OutputFile[];
      if (mode === 'merge' || mode === 'selected') {
        const chosen = mode === 'merge' ? pages : pages.filter((p) => selected.has(p.id));
        const fileName =
          sources.length === 1 ? t('pdf.fileName.edited', { name }) : t('pdf.fileName.merged');
        files = [
          {
            name: `${fileName}.pdf`,
            bytes: await buildPdf(sources, chosen, progress, flattenPage),
          },
        ];
      } else {
        const list = mode === 'each' ? pages.map((_, i) => [i + 1]) : (groups ?? []);
        files = await splitPdf(
          sources,
          pages,
          list,
          (group) =>
            `${t(group.length === 1 ? 'pdf.fileName.page' : 'pdf.fileName.part', {
              name,
              pages: groupLabel(group),
            })}.pdf`,
          progress,
          flattenPage,
        );
      }
      if (ocr) {
        // Text recognition runs on the server, one file after another.
        for (const [n, file] of files.entries()) {
          const searchable = await convertOnServer({
            file: new Blob([file.bytes.slice()], { type: 'application/pdf' }),
            fileName: file.name,
            outputExt: 'pdf',
            options: ocrOptions,
            mode: 'ocr',
            signal: abort.signal,
            onProgress: ({ percent }) =>
              setBusy({ done: n + 1, total: files.length, ocrPercent: percent }),
          });
          files[n] = { name: file.name, bytes: new Uint8Array(await searchable.arrayBuffer()) };
        }
      }
      let dropped = false;
      if (protect.watermark.trim()) {
        for (const [n, file] of files.entries()) {
          const marked = await addWatermark(file.bytes, {
            text: protect.watermark,
            position: protect.position,
          });
          dropped ||= marked.dropped;
          files[n] = { name: file.name, bytes: marked.bytes };
        }
      }
      if (protect.password) {
        // Browsers can't encrypt PDFs: qpdf on the server does it (the password goes there once).
        for (const [n, file] of files.entries()) {
          setBusy({ done: n + 1, total: files.length, locking: true });
          files[n] = {
            name: file.name,
            bytes: await pdfPassword(
              file.bytes,
              file.name,
              'protect',
              protect.password,
              abort.signal,
            ),
          };
        }
      }
      setDroppedChars(dropped);
      setResult({ files, inputs });
    } catch (err) {
      if (isAbortError(err)) return;
      console.error('pdf tool failed', err);
      setError(
        err instanceof ConversionError
          ? { messageKey: err.messageKey, ...(err.details && { details: err.details }), inputs }
          : { messageKey: 'errors.pdfBroken', details: String(err), inputs },
      );
    } finally {
      setBusy(null);
      setController(null);
    }
  };

  const blobs = useMemo(
    () =>
      result?.map((f) => ({
        fileName: f.name,
        blob: new Blob([f.bytes.slice()], { type: 'application/pdf' }),
      })) ?? [],
    [result],
  );
  const totalSize = blobs.reduce((sum, b) => sum + b.blob.size, 0);

  const download = async () => {
    const [single] = blobs;
    if (blobs.length === 1 && single) {
      saveBlob(single.blob, single.fileName);
      return;
    }
    setZipping(true);
    try {
      saveBlob(
        await createZip(blobs.map((b) => ({ name: b.fileName, blob: b.blob }))),
        zipFileName(),
      );
    } finally {
      setZipping(false);
    }
  };

  return (
    <Card className="gap-4 p-4">
      <fieldset className="space-y-2">
        <legend className="mb-2 font-medium">{t('pdf.output.label')}</legend>
        {MODES.map((m) => (
          <div key={m} className="flex items-start gap-2">
            <input
              type="radio"
              id={`pdf-mode-${m}`}
              name="pdf-mode"
              className="mt-1 size-4 accent-primary"
              checked={mode === m}
              disabled={m === 'selected' && selected.size === 0}
              onChange={() => setMode(m)}
            />
            <div className="min-w-0">
              <Label htmlFor={`pdf-mode-${m}`}>
                {t(`pdf.output.${m}.label`, { count: selected.size })}
              </Label>
              <p className="text-sm text-muted-foreground">{t(`pdf.output.${m}.help`)}</p>
            </div>
          </div>
        ))}
      </fieldset>

      {mode === 'ranges' && (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <Label htmlFor="pdf-ranges">{t('pdf.output.ranges.field')}</Label>
            <HelpTip helpKey="pdf.output.ranges.fieldHelp" labelKey="pdf.output.ranges.field" />
          </div>
          <Input
            id="pdf-ranges"
            value={ranges}
            placeholder={t('pdf.output.ranges.placeholder')}
            onChange={(e) => setRanges(e.target.value)}
            aria-invalid={rangesInvalid || undefined}
            aria-describedby={rangesInvalid ? 'pdf-ranges-error' : undefined}
            className="max-w-xs"
          />
          {rangesInvalid && (
            <p id="pdf-ranges-error" className="text-sm text-destructive">
              {t('pdf.output.ranges.invalid', { count: pages.length })}
            </p>
          )}
        </div>
      )}

      <OcrSection
        engine={ocrEngine}
        on={ocrOn}
        onToggle={setOcrOn}
        values={ocrOptions}
        onChange={(key, value) => setOcrOptions((o) => ({ ...o, [key]: value }))}
        disabled={busy !== null}
      />

      <ProtectSection value={protect} onChange={setProtect} disabled={busy !== null} />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void build()} disabled={!canBuild}>
          {busy ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <FileTextIcon aria-hidden="true" />
          )}
          {busy
            ? busy.locking
              ? t('pdf.protect.locking', { done: busy.done, total: busy.total })
              : busy.ocrPercent !== undefined
                ? t('pdf.output.recognizing', { ...busy, percent: busy.ocrPercent })
                : t('pdf.output.creating', { done: busy.done, total: busy.total })
            : t('pdf.output.create')}
        </Button>
        {controller && (ocr || protect.password) && (
          <Button variant="outline" onClick={() => controller.abort()}>
            {t('convert.cancel')}
          </Button>
        )}
      </div>

      {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}

      {result && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3" data-testid="pdf-result">
          <p className="text-sm">
            {t('pdf.output.ready', {
              count: result.length,
              name: result[0]?.name ?? '',
              size: formatBytes(totalSize, i18n.language),
            })}
          </p>
          {droppedChars && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {t('pdf.protect.droppedChars')}
            </p>
          )}
          {pages.some((p) => p.redactions?.length) && (
            <p className="text-sm text-muted-foreground">{t('pdf.redact.resultHint')}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void download()} disabled={zipping}>
              {zipping ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : (
                <DownloadIcon aria-hidden="true" />
              )}
              {t(result.length === 1 ? 'pdf.output.download' : 'pdf.output.downloadZip')}
            </Button>
            <SaveToStorageButton items={blobs} />
          </div>
        </div>
      )}
    </Card>
  );
}

/** PDF page tools: merge, split, sort, turn and remove pages – on this device. */
export function PdfView() {
  const { t } = useTranslation();
  const pages = usePdfTool((s) => s.pages);
  const sources = usePdfTool((s) => s.sources);
  const selected = usePdfTool((s) => s.selected);
  const rejected = usePdfTool((s) => s.rejected);
  const loading = usePdfTool((s) => s.loading);
  const { addFiles, rotate, remove, selectAll, clear, dismissRejected } = usePdfTool.getState();
  const chosen = [...selected];

  return (
    <div className="space-y-6">
      <ViewIntro help="pdf">{t('pdf.intro')}</ViewIntro>
      <Dropzone compact={pages.length > 0} onFiles={(files) => void addFiles(files)} />

      {loading > 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          {t('pdf.loading')}
        </p>
      )}

      <LockedFiles />

      {rejected.length > 0 && (
        <div className="space-y-2">
          {rejected.map((r, i) => (
            <div key={`${r.name}-${i}`} className="space-y-1">
              <p className="text-sm font-medium">{t('pdf.rejected', { name: r.name })}</p>
              <ErrorMessage messageKey={r.messageKey} details={r.details} />
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={dismissRejected}>
            {t('pdf.dismiss')}
          </Button>
        </div>
      )}

      {pages.length > 0 && (
        <>
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <p className="text-sm">
                {t('pdf.summary', { count: pages.length, files: sources.length })}
              </p>
              <p className="text-xs text-muted-foreground">{t('pdf.dragHint')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => selectAll(selected.size < pages.length)}
              >
                {t(selected.size < pages.length ? 'pdf.selectAll' : 'pdf.selectNone')}
              </Button>
              {chosen.length > 0 && (
                <>
                  <Button size="sm" variant="outline" onClick={() => rotate(chosen, -90)}>
                    <RotateCcwIcon aria-hidden="true" />
                    {t('pdf.rotateLeft', { count: chosen.length })}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => rotate(chosen, 90)}>
                    <RotateCwIcon aria-hidden="true" />
                    {t('pdf.rotateRight', { count: chosen.length })}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => remove(chosen)}>
                    <Trash2Icon aria-hidden="true" />
                    {t('pdf.removeSelected', { count: chosen.length })}
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" onClick={clear}>
                {t('pdf.clear')}
              </Button>
            </div>
          </div>

          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5"
            aria-label={t('pdf.pagesLabel')}
          >
            {pages.map((page, i) => (
              <li key={page.id}>
                <PageTile page={page} position={i + 1} total={pages.length} />
              </li>
            ))}
          </ul>

          <OutputPanel />
        </>
      )}
    </div>
  );
}
