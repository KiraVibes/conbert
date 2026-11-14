import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRightIcon, CheckCircle2Icon, Loader2Icon, XCircleIcon } from 'lucide-react';
import {
  TEXT_COMPARE_MAX_BYTES,
  bytesToHex,
  createByteCompare,
  diffLines,
  diffPixels,
  diffStats,
  foldDiff,
  sniffText,
  splitLines,
  type ByteComparison,
  type DiffRow,
  type PixelDiff,
  type TextEncoding,
} from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatBytes } from '@/lib/format-bytes';
import { FunSlider } from '../fun/FunParts';
import { hex } from '../save-blob';
import { HowItWorks, SingleFile } from '../SingleFile';

const PIECE = 8 * 1024 * 1024;
const MAX_ROWS = 4000;
const MAX_IMAGE_PIXELS = 40_000_000;

async function compareBytes(
  a: File,
  b: File,
  onProgress: (f: number) => void,
  signal: AbortSignal,
) {
  const cmp = createByteCompare(a.size, b.size);
  const common = Math.min(a.size, b.size);
  for (let at = 0; at < common; at += PIECE) {
    if (signal.aborted) return null;
    const end = Math.min(common, at + PIECE);
    const [x, y] = await Promise.all([
      a.slice(at, end).arrayBuffer(),
      b.slice(at, end).arrayBuffer(),
    ]);
    cmp.feed(new Uint8Array(x), new Uint8Array(y), at);
    onProgress(end / Math.max(1, common));
  }
  return cmp.result();
}

const DECODER: Record<TextEncoding, string> = {
  'utf-8': 'utf-8',
  'utf-8-bom': 'utf-8',
  'utf-16le': 'utf-16le',
  'utf-16be': 'utf-16be',
  ascii: 'utf-8',
  latin1: 'windows-1252',
};

async function readText(file: File): Promise<string | null> {
  if (file.size > TEXT_COMPARE_MAX_BYTES) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = sniffText(bytes.subarray(0, 65_536));
  if (!encoding) return null;
  return new TextDecoder(DECODER[encoding]).decode(bytes);
}

async function readImage(file: File): Promise<ImageBitmap | null> {
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
      bitmap.close();
      return null;
    }
    return bitmap;
  } catch {
    return null;
  }
}

/** Pixels of a picture, scaled to `w`×`h` when it has another size. */
function pixelsOf(bitmap: ImageBitmap, w: number, h: number): Uint8ClampedArray {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

type Kind =
  | { kind: 'text'; rows: DiffRow[] | null; stats: ReturnType<typeof diffStats> | null }
  | { kind: 'image'; a: ImageBitmap; b: ImageBitmap; resized: boolean }
  | { kind: 'bytes' };

function Verdict({ result, a, b }: { result: ByteComparison; a: File; b: File }) {
  const { t, i18n } = useTranslation();
  const same = result.firstDiff === null;
  return (
    <Card className="flex-row items-start gap-3 px-4 py-3" role="status">
      {same ? (
        <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-green-600" aria-hidden="true" />
      ) : (
        <XCircleIcon className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
      )}
      <div className="space-y-1 text-sm">
        <p className="font-medium">
          {same ? t('workshop.compare.identical') : t('workshop.compare.different')}
        </p>
        {!same && (
          <p className="text-muted-foreground">
            {a.size === b.size
              ? t('workshop.compare.sameSize', {
                  size: formatBytes(a.size, i18n.language),
                  count: result.differing,
                  first: result.firstDiff ?? 0,
                })
              : t('workshop.compare.otherSize', {
                  a: formatBytes(a.size, i18n.language),
                  b: formatBytes(b.size, i18n.language),
                  first: result.firstDiff ?? 0,
                })}
          </p>
        )}
      </div>
    </Card>
  );
}

function TextDiff({ rows, stats }: { rows: DiffRow[]; stats: ReturnType<typeof diffStats> }) {
  const { t } = useTranslation();
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span className="text-green-700 dark:text-green-400">
          {t('workshop.compare.added', { count: stats.added })}
        </span>
        {' · '}
        <span className="text-red-700 dark:text-red-400">
          {t('workshop.compare.removed', { count: stats.removed })}
        </span>
        {' · '}
        <span className="text-muted-foreground">
          {t('workshop.compare.unchanged', { count: stats.same })}
        </span>
      </p>
      <div className="max-h-[32rem] overflow-auto rounded-lg border font-mono text-xs">
        <table className="w-full border-collapse">
          <tbody>
            {shown.map((row, i) => {
              if (row.kind === 'skip') {
                return (
                  <tr key={i} className="bg-muted/50 text-muted-foreground">
                    <td colSpan={3} className="px-2 py-0.5 text-center">
                      {t('workshop.compare.skipped', { count: row.count })}
                    </td>
                  </tr>
                );
              }
              const tone =
                row.kind === 'add' ? 'bg-green-500/15' : row.kind === 'del' ? 'bg-red-500/15' : '';
              return (
                <tr key={i} className={tone}>
                  <td className="w-12 border-r px-1 text-right text-muted-foreground select-none">
                    {row.kind !== 'add' ? row.a + 1 : ''}
                  </td>
                  <td className="w-12 border-r px-1 text-right text-muted-foreground select-none">
                    {row.kind !== 'del' ? row.b + 1 : ''}
                  </td>
                  <td className="px-2 whitespace-pre-wrap break-all">
                    <span aria-hidden="true" className="mr-1 select-none">
                      {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
                    </span>
                    <span className="sr-only">
                      {row.kind === 'add'
                        ? t('workshop.compare.srAdded')
                        : row.kind === 'del'
                          ? t('workshop.compare.srRemoved')
                          : ''}
                    </span>
                    {row.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > MAX_ROWS && (
        <p className="text-xs text-muted-foreground">
          {t('workshop.compare.moreRows', { count: rows.length - MAX_ROWS })}
        </p>
      )}
    </div>
  );
}

function ImageDiff({ a, b, resized }: { a: ImageBitmap; b: ImageBitmap; resized: boolean }) {
  const { t, i18n } = useTranslation();
  const [split, setSplit] = useState(50);
  const [tolerance, setTolerance] = useState(16);
  const urls = useRef<{ a: string; b: string } | null>(null);
  const [srcs, setSrcs] = useState<{ a: string; b: string } | null>(null);
  const maskCanvas = useRef<HTMLCanvasElement>(null);
  const w = a.width;
  const h = a.height;
  const pixels = useMemo(() => ({ a: pixelsOf(a, w, h), b: pixelsOf(b, w, h) }), [a, b, w, h]);
  const diff: PixelDiff = useMemo(
    () => diffPixels(pixels.a, pixels.b, tolerance),
    [pixels, tolerance],
  );

  useEffect(() => {
    let cancelled = false;
    const toUrl = async (bitmap: ImageBitmap) => {
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d')?.drawImage(bitmap, 0, 0, w, h);
      return URL.createObjectURL(await c.convertToBlob());
    };
    void Promise.all([toUrl(a), toUrl(b)]).then(([ua, ub]) => {
      if (cancelled) {
        URL.revokeObjectURL(ua);
        URL.revokeObjectURL(ub);
        return;
      }
      urls.current = { a: ua, b: ub };
      setSrcs({ a: ua, b: ub });
    });
    return () => {
      cancelled = true;
      if (urls.current) {
        URL.revokeObjectURL(urls.current.a);
        URL.revokeObjectURL(urls.current.b);
        urls.current = null;
      }
    };
  }, [a, b, w, h]);

  useEffect(() => {
    const canvas = maskCanvas.current;
    if (!canvas) return;
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.putImageData(new ImageData(diff.mask, w, h), 0, 0);
  }, [diff, w, h]);

  const percent = (diff.changed / Math.max(1, diff.total)) * 100;
  return (
    <div className="space-y-3">
      {resized && <p className="text-sm text-muted-foreground">{t('workshop.compare.resized')}</p>}
      <p className="text-sm">
        {diff.changed === 0
          ? t('workshop.compare.pixelsSame')
          : t('workshop.compare.pixelsChanged', {
              percent:
                percent < 0.01
                  ? `< ${(0.01).toLocaleString(i18n.language)}`
                  : percent.toLocaleString(i18n.language, { maximumFractionDigits: 2 }),
              count: diff.changed,
            })}
      </p>
      <Tabs defaultValue="slider" className="gap-3">
        <TabsList>
          <TabsTrigger value="slider">{t('workshop.compare.slider')}</TabsTrigger>
          <TabsTrigger value="mask">{t('workshop.compare.mask')}</TabsTrigger>
          <TabsTrigger value="side">{t('workshop.compare.side')}</TabsTrigger>
        </TabsList>
        <TabsContent value="slider" className="space-y-2">
          {srcs && (
            <div className="relative max-w-full overflow-hidden rounded-lg border bg-muted/30">
              <img src={srcs.b} alt={t('workshop.compare.fileB')} className="block h-auto w-full" />
              <img
                src={srcs.a}
                alt={t('workshop.compare.fileA')}
                className="absolute inset-0 block h-auto w-full"
                style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
              />
              <div
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary"
                style={{ left: `${split}%` }}
              />
            </div>
          )}
          <input
            type="range"
            min={0}
            max={100}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
            className="w-full accent-primary"
            aria-label={t('workshop.compare.sliderLabel')}
          />
          <p className="text-xs text-muted-foreground">{t('workshop.compare.sliderHint')}</p>
        </TabsContent>
        <TabsContent value="mask" forceMount className="space-y-3 data-[state=inactive]:hidden">
          <canvas
            ref={maskCanvas}
            className="h-auto w-full rounded-lg border"
            aria-label={t('workshop.compare.maskLabel')}
          />
          <FunSlider
            label={t('workshop.compare.tolerance')}
            labelKey="workshop.compare.tolerance"
            helpKey="workshop.compare.toleranceHelp"
            value={tolerance}
            min={0}
            max={128}
            onChange={setTolerance}
          />
        </TabsContent>
        <TabsContent value="side">
          {srcs && (
            <div className="grid gap-2 sm:grid-cols-2">
              <figure className="space-y-1">
                <img src={srcs.a} alt={t('workshop.compare.fileA')} className="rounded-lg border" />
                <figcaption className="text-xs text-muted-foreground">
                  {t('workshop.compare.fileA')}
                </figcaption>
              </figure>
              <figure className="space-y-1">
                <img src={srcs.b} alt={t('workshop.compare.fileB')} className="rounded-lg border" />
                <figcaption className="text-xs text-muted-foreground">
                  {t('workshop.compare.fileB')}
                </figcaption>
              </figure>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ByteRanges({ a, b, result }: { a: File; b: File; result: ByteComparison }) {
  const { t } = useTranslation();
  const [snippets, setSnippets] = useState<{ a: string; b: string }[]>([]);
  const shown = result.ranges.slice(0, 50);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      shown.map(async (r) => {
        const read = async (f: File) =>
          r.start >= f.size
            ? '—'
            : bytesToHex(new Uint8Array(await f.slice(r.start, r.start + 16).arrayBuffer()), true);
        return { a: await read(a), b: await read(b) };
      }),
    ).then((list) => {
      if (!cancelled) setSnippets(list);
    });
    return () => {
      cancelled = true;
    };
    // `shown` follows from `result`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b, result]);
  if (shown.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('workshop.compare.ranges')}</p>
      <div className="max-h-96 overflow-auto rounded-lg border">
        <table className="w-full text-left font-mono text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-2 py-1">{t('workshop.compare.offset')}</th>
              <th className="px-2 py-1">{t('workshop.compare.length')}</th>
              <th className="px-2 py-1">{t('workshop.compare.fileA')}</th>
              <th className="px-2 py-1">{t('workshop.compare.fileB')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.start} className="border-t align-top">
                <td className="px-2 py-1">0x{hex(r.start, 8)}</td>
                <td className="px-2 py-1">{r.end - r.start}</td>
                <td className="px-2 py-1 break-all">{snippets[i]?.a ?? '…'}</td>
                <td className="px-2 py-1 break-all">{snippets[i]?.b ?? '…'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(result.moreRanges || result.ranges.length > shown.length) && (
        <p className="text-xs text-muted-foreground">{t('workshop.compare.moreRanges')}</p>
      )}
    </div>
  );
}

/** Compare two files: text line by line, pictures pixel by pixel, anything byte by byte. */
export function CompareTool() {
  const { t } = useTranslation();
  const [a, setA] = useState<File | null>(null);
  const [b, setB] = useState<File | null>(null);
  // Results remember the pair they belong to; a new pair hides old results at once.
  const [state, setState] = useState<{
    a: File;
    b: File;
    progress: number | null;
    bytes: ByteComparison | null;
    view: Kind | null;
  } | null>(null);
  const current = state && state.a === a && state.b === b ? state : null;
  const progress = a && b ? (current ? current.progress : 0) : null;
  const bytes = current?.bytes ?? null;
  const view = current?.view ?? null;

  useEffect(() => {
    if (!a || !b) return;
    const abort = new AbortController();
    const update = (patch: Partial<NonNullable<typeof state>>) =>
      setState((old) => ({
        ...(old && old.a === a && old.b === b
          ? old
          : { a, b, progress: 0, bytes: null, view: null }),
        ...patch,
      }));
    void (async () => {
      const result = await compareBytes(a, b, (f) => update({ progress: f }), abort.signal);
      if (!result || abort.signal.aborted) return;
      update({ bytes: result, progress: null });
      if (result.firstDiff === null) return;
      const [ia, ib] = await Promise.all([readImage(a), readImage(b)]);
      if (abort.signal.aborted) return;
      if (ia && ib) {
        update({
          view: {
            kind: 'image',
            a: ia,
            b: ib,
            resized: ia.width !== ib.width || ia.height !== ib.height,
          },
        });
        return;
      }
      const [ta, tb] = await Promise.all([readText(a), readText(b)]);
      if (abort.signal.aborted) return;
      if (ta !== null && tb !== null) {
        const ops = diffLines(splitLines(ta), splitLines(tb));
        update({
          view: {
            kind: 'text',
            rows: ops ? foldDiff(ops) : null,
            stats: ops ? diffStats(ops) : null,
          },
        });
        return;
      }
      update({ view: { kind: 'bytes' } });
    })().catch((error: unknown) => {
      console.error('compare failed', error);
      update({ progress: null, view: { kind: 'bytes' } });
    });
    return () => abort.abort();
  }, [a, b]);

  return (
    <div className="space-y-4">
      <HowItWorks trick="compare" />
      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-start">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('workshop.compare.fileA')}</p>
          <SingleFile file={a} onFile={setA} />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="self-center justify-self-center md:mt-6"
          aria-label={t('workshop.compare.swap')}
          title={t('workshop.compare.swap')}
          disabled={!a && !b}
          onClick={() => {
            setA(b);
            setB(a);
          }}
        >
          <ArrowLeftRightIcon aria-hidden="true" />
        </Button>
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('workshop.compare.fileB')}</p>
          <SingleFile file={b} onFile={setB} />
        </div>
      </div>
      {progress !== null && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          {t('workshop.compare.comparing', { percent: Math.round(progress * 100) })}
        </p>
      )}
      {a && b && bytes && <Verdict result={bytes} a={a} b={b} />}
      {view?.kind === 'image' && <ImageDiff a={view.a} b={view.b} resized={view.resized} />}
      {view?.kind === 'text' &&
        (view.rows && view.stats ? (
          <TextDiff rows={view.rows} stats={view.stats} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('workshop.compare.tooDifferent')}</p>
        ))}
      {a && b && bytes && view?.kind === 'bytes' && <ByteRanges a={a} b={b} result={bytes} />}
    </div>
  );
}
