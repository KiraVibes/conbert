import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Comlink from 'comlink';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CameraIcon,
  CropIcon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  RotateCwIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  ConversionError,
  DEFAULT_QUAD,
  SCAN_FILTERS,
  isAbortError,
  type Point,
  type Quad,
  type ScanFilter,
} from '@conbert/core';
import { ErrorMessage } from '@/components/ErrorMessage';
import { HelpTip } from '@/components/HelpTip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { convertOnServer } from '@/engines/server-convert';
import { Dropzone } from '@/features/convert/Dropzone';
import { OcrSection } from '@/features/pdf/OcrSection';
import { useOcrEngine } from '@/features/pdf/use-ocr-engine';
import { createId } from '@/lib/id';
import { formatBytes } from '@/lib/format-bytes';
import { createZip, saveBlob } from '@/lib/zip';
import type { ScannerWorkerApi } from '@/workers/scanner.worker';
import { HowItWorks } from '../SingleFile';

let worker: Comlink.Remote<ScannerWorkerApi> | null = null;
function scanner(): Comlink.Remote<ScannerWorkerApi> {
  worker ??= Comlink.wrap<ScannerWorkerApi>(
    new Worker(new URL('../../../workers/scanner.worker.ts', import.meta.url), {
      type: 'module',
      name: 'workshop-scanner',
    }),
  );
  return worker;
}

const PREVIEW_SIDE = 900;
const FINAL_SIDE = 2400;
/** A4 in PDF points (1/72 inch). */
const A4: [number, number] = [595.28, 841.89];

interface ScanPage {
  id: string;
  file: File;
  /** Photo as object URL (for the corner editor). */
  photo: string;
  quad: Quad;
  found: boolean;
  filter: ScanFilter;
  turns: number;
  preview: string | null;
}

// --- Corner editor -------------------------------------------------------------

function CornerEditor({
  page,
  open,
  onClose,
  onSave,
}: {
  page: ScanPage;
  open: boolean;
  onClose: () => void;
  onSave: (quad: Quad) => void;
}) {
  const { t } = useTranslation();
  const [quad, setQuad] = useState<Quad>(page.quad);
  const [shownFor, setShownFor] = useState(false);
  if (open !== shownFor) {
    setShownFor(open);
    if (open) setQuad(page.quad);
  }
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const names = [
    t('workshop.scanner.corners.tl'),
    t('workshop.scanner.corners.tr'),
    t('workshop.scanner.corners.br'),
    t('workshop.scanner.corners.bl'),
  ];

  const move = (i: number, p: Point) =>
    setQuad((old) => {
      const next = [...old] as Quad;
      next[i] = { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) };
      return next;
    });
  const point = (e: React.PointerEvent): Point => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[95vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('workshop.scanner.cornersTitle')}</DialogTitle>
          <DialogDescription>{t('workshop.scanner.cornersIntro')}</DialogDescription>
        </DialogHeader>
        <div
          ref={box}
          className="relative mx-auto w-fit max-w-full touch-none select-none"
          onPointerMove={(e) => {
            if (dragging.current !== null) move(dragging.current, point(e));
          }}
          onPointerUp={() => (dragging.current = null)}
          onPointerCancel={() => (dragging.current = null)}
        >
          <img
            src={page.photo}
            alt={t('workshop.scanner.photoAlt')}
            className="block h-auto max-h-[65vh] w-auto max-w-full rounded"
            draggable={false}
          />
          <svg
            className="pointer-events-none absolute inset-0 size-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon
              points={quad.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="rgba(124,58,237,0.18)"
              stroke="#a78bfa"
              strokeWidth={0.004}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {quad.map((p, i) => (
            <button
              key={i}
              type="button"
              className="absolute size-7 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-primary shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              aria-label={t('workshop.scanner.cornerLabel', { corner: names[i] })}
              onPointerDown={(e) => {
                e.preventDefault();
                box.current?.setPointerCapture?.(e.pointerId);
                dragging.current = i;
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.02 : 0.004;
                const d: Record<string, [number, number]> = {
                  ArrowLeft: [-step, 0],
                  ArrowRight: [step, 0],
                  ArrowUp: [0, -step],
                  ArrowDown: [0, step],
                };
                const delta = d[e.key];
                if (!delta) return;
                e.preventDefault();
                move(i, { x: p.x + delta[0], y: p.y + delta[1] });
              }}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('workshop.scanner.keyboardHint')}</p>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => setQuad([...DEFAULT_QUAD] as Quad)}>
            {t('workshop.scanner.wholePhoto')}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('workshop.scanner.cancel')}
            </Button>
            <Button
              onClick={() => {
                onSave(quad);
                onClose();
              }}
            >
              {t('workshop.scanner.apply')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- One page ------------------------------------------------------------------

function PageCard({
  page,
  position,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  page: ScanPage;
  position: number;
  total: number;
  onChange: (patch: Partial<ScanPage>) => void;
  onRemove: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const label = t('workshop.scanner.pageLabel', { n: position });
  return (
    <Card className="gap-2 p-2">
      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded border bg-muted">
        {page.preview ? (
          <img src={page.preview} alt={label} className="max-h-full max-w-full object-contain" />
        ) : (
          <Loader2Icon
            className="size-5 animate-spin text-muted-foreground"
            aria-label={t('workshop.scanner.working')}
          />
        )}
      </div>
      <p className="text-sm font-medium">{label}</p>
      {!page.found && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('workshop.scanner.notFound')}
        </p>
      )}
      <Select value={page.filter} onValueChange={(v) => onChange({ filter: v as ScanFilter })}>
        <SelectTrigger
          className="h-8 w-full text-xs"
          aria-label={t('workshop.scanner.filterFor', { label })}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCAN_FILTERS.map((f) => (
            <SelectItem key={f} value={f}>
              {t(`workshop.scanner.filters.${f}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex justify-between">
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => setEditing(true)}
          aria-label={t('workshop.scanner.editCorners', { label })}
          title={t('workshop.scanner.editCorners', { label })}
        >
          <CropIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => onChange({ turns: page.turns + 1 })}
          aria-label={t('workshop.scanner.rotate', { label })}
          title={t('workshop.scanner.rotate', { label })}
        >
          <RotateCwIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          disabled={position === 1}
          onClick={() => onMove(-1)}
          aria-label={t('workshop.scanner.moveUp', { label })}
        >
          <ArrowUpIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          disabled={position === total}
          onClick={() => onMove(1)}
          aria-label={t('workshop.scanner.moveDown', { label })}
        >
          <ArrowDownIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={onRemove}
          aria-label={t('workshop.scanner.remove', { label })}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
      <CornerEditor
        page={page}
        open={editing}
        onClose={() => setEditing(false)}
        onSave={(quad) => onChange({ quad })}
      />
    </Card>
  );
}

// --- The tool --------------------------------------------------------------------

/** PDF page size: A4 when the scan is about A4-shaped, else A4 width with the scan's proportions. */
function pageSize(width: number, height: number): [number, number] {
  const landscape = width > height;
  const [w, h] = landscape ? [A4[1], A4[0]] : A4;
  const ratio = height / width;
  if (Math.abs(ratio - h / w) / (h / w) < 0.06) return [w, h];
  return [w, w * ratio];
}

/** Document scanner: photos of paper → straight, clean pages → PDF. */
export function ScannerTool() {
  const { t, i18n } = useTranslation();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [busy, setBusy] = useState<{ done: number; total: number; ocr?: number } | null>(null);
  const [error, setError] = useState<{ messageKey: string; details?: string } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const ocrEngine = useOcrEngine();
  const [ocrOn, setOcrOn] = useState(false);
  const [ocrOptions, setOcrOptions] = useState<Record<string, unknown>>({});
  const camera = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const rendered = useRef(new Map<string, string>());
  // Free the photos and previews when the tool closes.
  const latest = useRef(pages);
  useEffect(() => {
    latest.current = pages;
  }, [pages]);
  useEffect(
    () => () => {
      for (const p of latest.current) {
        URL.revokeObjectURL(p.photo);
        if (p.preview) URL.revokeObjectURL(p.preview);
      }
    },
    [],
  );

  const update = (id: string, patch: Partial<ScanPage>) =>
    setPages((old) => old.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  // A new preview whenever corners, filter or turns change.
  const keys = pages
    .map((p) => `${p.id}|${p.quad.map((c) => `${c.x},${c.y}`).join(';')}|${p.filter}|${p.turns}`)
    .join('\n');
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const page of pages) {
        const key = `${page.quad.map((c) => `${c.x},${c.y}`).join(';')}|${page.filter}|${page.turns}`;
        if (rendered.current.get(page.id) === key) continue;
        const out = await scanner().process(
          page.id,
          page.file,
          page.quad,
          page.filter,
          page.turns,
          PREVIEW_SIDE,
        );
        if (!alive) return;
        rendered.current.set(page.id, key);
        const url = URL.createObjectURL(out.blob);
        setPages((old) =>
          old.map((p) => {
            if (p.id !== page.id) return p;
            if (p.preview) URL.revokeObjectURL(p.preview);
            return { ...p, preview: url };
          }),
        );
      }
    })().catch((err: unknown) => console.error('scan preview failed', err));
    return () => {
      alive = false;
    };
    // `keys` stands for everything a preview depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);

  const add = async (files: File[]) => {
    setResult(null);
    for (const file of files) {
      try {
        const found = await scanner().detect(file);
        const page: ScanPage = {
          id: createId(),
          file,
          photo: URL.createObjectURL(file),
          quad: found.quad ?? ([...DEFAULT_QUAD] as Quad),
          found: found.quad !== null,
          filter: 'color',
          turns: 0,
          preview: null,
        };
        setPages((old) => [...old, page]);
      } catch (err) {
        console.warn('scanner could not read', file.name, err);
        setFailed((old) => [...old, file.name]);
      }
    }
  };

  const remove = (id: string) =>
    setPages((old) => {
      const page = old.find((p) => p.id === id);
      if (page) {
        URL.revokeObjectURL(page.photo);
        if (page.preview) URL.revokeObjectURL(page.preview);
        void scanner().forget(id);
        rendered.current.delete(id);
      }
      return old.filter((p) => p.id !== id);
    });

  const move = (id: string, by: -1 | 1) =>
    setPages((old) => {
      const i = old.findIndex((p) => p.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= old.length) return old;
      const next = [...old];
      [next[i], next[j]] = [next[j] as ScanPage, next[i] as ScanPage];
      return next;
    });

  const finalPages = async (signal: AbortSignal) => {
    const out: { blob: Blob; width: number; height: number }[] = [];
    for (const [n, page] of pages.entries()) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      setBusy({ done: n, total: pages.length });
      out.push(
        await scanner().process(page.id, page.file, page.quad, page.filter, page.turns, FINAL_SIDE),
      );
    }
    return out;
  };

  const makePdf = async () => {
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    setResult(null);
    try {
      const scans = await finalPages(abort.signal);
      const { PDFDocument } = await import('pdf-lib');
      const doc = await PDFDocument.create();
      for (const scan of scans) {
        const bytes = new Uint8Array(await scan.blob.arrayBuffer());
        const image =
          scan.blob.type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const [w, h] = pageSize(scan.width, scan.height);
        doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
      }
      doc.setTitle(t('workshop.scanner.pdfTitle'));
      let blob = new Blob([(await doc.save()) as Uint8Array<ArrayBuffer>], {
        type: 'application/pdf',
      });
      const name = `${t('workshop.scanner.fileName')}.pdf`;
      if (ocrOn && ocrEngine) {
        blob = await convertOnServer({
          file: blob,
          fileName: name,
          outputExt: 'pdf',
          options: ocrOptions,
          mode: 'ocr',
          signal: abort.signal,
          onProgress: ({ percent }) =>
            setBusy({ done: scans.length, total: scans.length, ocr: percent }),
        });
      }
      setResult({ blob, name });
      saveBlob(blob, name);
    } catch (err) {
      if (isAbortError(err)) return;
      console.error('scanner pdf failed', err);
      setError(
        err instanceof ConversionError
          ? { messageKey: err.messageKey, ...(err.details && { details: err.details }) }
          : { messageKey: 'errors.convertFailed', details: String(err) },
      );
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  };

  const makeImages = async () => {
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    try {
      const scans = await finalPages(abort.signal);
      const base = t('workshop.scanner.fileName');
      const files = scans.map((s, i) => ({
        name: `${base}-${String(i + 1).padStart(2, '0')}.${s.blob.type === 'image/png' ? 'png' : 'jpg'}`,
        blob: s.blob,
      }));
      const [single] = files;
      if (files.length === 1 && single) saveBlob(single.blob, single.name);
      else saveBlob(await createZip(files), `${base}.zip`);
    } catch (err) {
      if (!isAbortError(err)) {
        console.error('scanner images failed', err);
        setError({ messageKey: 'errors.convertFailed', details: String(err) });
      }
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  };

  return (
    <div className="space-y-4">
      <HowItWorks trick="scanner" />
      <div className="space-y-2">
        <Dropzone compact={pages.length > 0} onFiles={(files) => void add(files)} />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void add([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <Button variant="outline" onClick={() => camera.current?.click()}>
          <CameraIcon aria-hidden="true" />
          {t('workshop.scanner.camera')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('workshop.scanner.tips')}</p>
      </div>
      {failed.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.scanner.unreadable', { names: failed.join(', ') })}
        </p>
      )}

      {pages.length > 0 && (
        <>
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
            aria-label={t('workshop.scanner.pages')}
          >
            {pages.map((page, i) => (
              <li key={page.id}>
                <PageCard
                  page={page}
                  position={i + 1}
                  total={pages.length}
                  onChange={(patch) => update(page.id, patch)}
                  onRemove={() => remove(page.id)}
                  onMove={(by) => move(page.id, by)}
                />
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <span className="text-sm">{t('workshop.scanner.allFilter')}</span>
            <HelpTip helpKey="workshop.scanner.filterHelp" labelKey="workshop.scanner.allFilter" />
            <Select
              onValueChange={(v) =>
                setPages((old) => old.map((p) => ({ ...p, filter: v as ScanFilter })))
              }
            >
              <SelectTrigger
                className="h-8 w-44 text-xs"
                aria-label={t('workshop.scanner.allFilter')}
              >
                <SelectValue placeholder={t('workshop.scanner.choose')} />
              </SelectTrigger>
              <SelectContent>
                {SCAN_FILTERS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {t(`workshop.scanner.filters.${f}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <OcrSection
            engine={ocrEngine}
            on={ocrOn}
            onToggle={setOcrOn}
            values={ocrOptions}
            onChange={(key, value) => setOcrOptions((o) => ({ ...o, [key]: value }))}
            disabled={busy !== null}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void makePdf()} disabled={busy !== null}>
              {busy ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : (
                <FileTextIcon aria-hidden="true" />
              )}
              {busy
                ? busy.ocr !== undefined
                  ? t('workshop.scanner.recognizing', { percent: busy.ocr })
                  : t('workshop.scanner.making', { done: busy.done + 1, total: busy.total })
                : t('workshop.scanner.makePdf', { count: pages.length })}
            </Button>
            <Button variant="outline" onClick={() => void makeImages()} disabled={busy !== null}>
              <DownloadIcon aria-hidden="true" />
              {t('workshop.scanner.saveImages', { count: pages.length })}
            </Button>
            {busy && (
              <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
                {t('workshop.scanner.cancel')}
              </Button>
            )}
          </div>
          {error && <ErrorMessage messageKey={error.messageKey} details={error.details} />}
          {result && (
            <p role="status" className="text-sm">
              {t('workshop.scanner.done', {
                name: result.name,
                size: formatBytes(result.blob.size, i18n.language),
              })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
