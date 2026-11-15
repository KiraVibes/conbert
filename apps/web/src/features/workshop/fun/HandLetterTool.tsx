import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon, PenLineIcon, ShuffleIcon } from 'lucide-react';
import type { Font } from 'opentype.js';
import {
  DEFAULT_LETTER,
  LETTER_INKS,
  LETTER_PAPERS,
  layoutLetter,
  type LetterInk,
  type LetterOptions,
  type LetterPaper,
  type PlacedGlyph,
} from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { rememberedHandFont } from '../makers/hand-font-store';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';

const PT = 72 / 25.4;
/** Preview: pixels per mm. */
const PREVIEW = 3;

/** One letter's outline as SVG path data, placed and tilted (`unit` = output units per mm). */
function glyphPath(font: Font, g: PlacedGlyph, unit: number): string {
  const path = font.charToGlyph(g.ch).getPath(0, 0, g.size * unit);
  const a = (g.rotate * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const ox = g.x * unit;
  const oy = g.y * unit;
  const p = (x: number, y: number) =>
    `${(ox + x * cos - y * sin).toFixed(2)} ${(oy + x * sin + y * cos).toFixed(2)}`;
  let d = '';
  for (const c of path.commands) {
    if (c.type === 'M') d += `M${p(c.x, c.y)}`;
    else if (c.type === 'L') d += `L${p(c.x, c.y)}`;
    else if (c.type === 'Q') d += `Q${p(c.x1, c.y1)} ${p(c.x, c.y)}`;
    else if (c.type === 'C') d += `C${p(c.x1, c.y1)} ${p(c.x2, c.y2)} ${p(c.x, c.y)}`;
    else d += 'Z';
  }
  return d;
}

/** Paper lines (lined or squared) in mm, as [x1, y1, x2, y2]. */
function paperLines(paper: LetterPaper, o: LetterOptions): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  if (paper === 'lined')
    for (
      let y = o.margin.top + o.size * 0.8;
      y <= o.pageH - o.margin.bottom + 0.1;
      y += o.lineHeight
    )
      out.push([o.margin.left - 5, y, o.pageW - o.margin.right + 5, y]);
  if (paper === 'squared') {
    for (let y = 10; y < o.pageH - 5; y += 5) out.push([10, y, o.pageW - 10, y]);
    for (let x = 10; x < o.pageW - 5; x += 5) out.push([x, 10, x, o.pageH - 10]);
  }
  return out;
}

const hex = (c: string) =>
  [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16) / 255) as [number, number, number];

/** Brief in Handschrift – text set with your handwriting font, a little uneven, as PDF. */
export function HandLetterTool() {
  const { t } = useTranslation();
  const [remembered] = useState(rememberedHandFont);
  const [fontFile, setFontFile] = useState<File | null>(null);
  const [font, setFont] = useState<{ source: string; font: Font } | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState(t('workshop.handletter.sample'));
  const [size, setSize] = useState(DEFAULT_LETTER.size);
  const [spacing, setSpacing] = useState(1.25);
  const [wobble, setWobble] = useState(DEFAULT_LETTER.wobble);
  const [ink, setInk] = useState<LetterInk>('blue');
  const [paper, setPaper] = useState<LetterPaper>('lined');
  const [seed, setSeed] = useState(1);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = fontFile
    ? `file:${fontFile.name}:${fontFile.size}`
    : remembered
      ? 'remembered'
      : '';

  useEffect(() => {
    if (!source) return;
    let active = true;
    void (async () => {
      try {
        const opentype = await import('opentype.js');
        const buf = fontFile ? await fontFile.arrayBuffer() : remembered?.otf;
        if (!buf) return;
        const parsed = opentype.parse(buf);
        if (active) {
          setFont({ source, font: parsed });
          setFailed(false);
        }
      } catch (e) {
        console.error(e);
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [source, fontFile, remembered]);

  const current = font && font.source === source ? font.font : null;
  const options: LetterOptions = useMemo(
    () => ({ ...DEFAULT_LETTER, size, lineHeight: size * spacing, wobble, seed }),
    [size, spacing, wobble, seed],
  );
  const pages = useMemo(() => {
    if (!current) return null;
    const em = current.unitsPerEm || 1000;
    const advance = (ch: string) => current.charToGlyph(ch).advanceWidth / em;
    return layoutLetter(text, advance, options);
  }, [current, text, options]);
  const missing = useMemo(() => {
    if (!current) return [];
    return [...new Set([...text].filter((c) => c.trim() && current.charToGlyph(c).index === 0))];
  }, [current, text]);
  const shownPage = pages ? Math.min(page, pages.length - 1) : 0;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !pages || !current) return;
    c.width = options.pageW * PREVIEW;
    c.height = options.pageH * PREVIEW;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = paper === 'squared' ? '#c9d6ea' : '#b9cbe8';
    ctx.lineWidth = 0.6;
    for (const [x1, y1, x2, y2] of paperLines(paper, options)) {
      ctx.beginPath();
      ctx.moveTo(x1 * PREVIEW, y1 * PREVIEW);
      ctx.lineTo(x2 * PREVIEW, y2 * PREVIEW);
      ctx.stroke();
    }
    ctx.fillStyle = LETTER_INKS[ink];
    for (const g of pages[shownPage] ?? []) ctx.fill(new Path2D(glyphPath(current, g, PREVIEW)));
  }, [pages, current, options, paper, ink, shownPage]);

  async function pdf() {
    if (!pages || !current) return;
    setBusy(true);
    try {
      const { PDFDocument, rgb } = await import('pdf-lib');
      const doc = await PDFDocument.create();
      const [r, g, b] = hex(LETTER_INKS[ink]);
      for (const glyphs of pages) {
        const p = doc.addPage([options.pageW * PT, options.pageH * PT]);
        const h = options.pageH * PT;
        for (const [x1, y1, x2, y2] of paperLines(paper, options))
          p.drawLine({
            start: { x: x1 * PT, y: h - y1 * PT },
            end: { x: x2 * PT, y: h - y2 * PT },
            thickness: 0.4,
            color: rgb(0.74, 0.8, 0.91),
          });
        // Outlines straight from the font: sharp at any size, no font file inside the PDF.
        for (const gl of glyphs) {
          const d = glyphPath(current, gl, PT);
          if (d) p.drawSvgPath(d, { x: 0, y: h, color: rgb(r, g, b) });
        }
      }
      saveBlob(
        new Blob([(await doc.save()) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
        t('workshop.handletter.fileName'),
      );
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    set: (v: number) => void,
  ) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => set(v ?? value)}
        aria-label={label}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <HowItWorks trick="handletter" />
      <div className="space-y-2">
        {remembered && !fontFile ? (
          <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
            <PenLineIcon className="size-4 shrink-0" aria-hidden="true" />
            {t('workshop.handletter.usingRemembered', { name: remembered.name })}
          </p>
        ) : (
          !fontFile && (
            <p className="text-sm text-muted-foreground">{t('workshop.handletter.needFont')}</p>
          )
        )}
        <SingleFile file={fontFile} onFile={setFontFile} />
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {t('workshop.handletter.failed')}
          </p>
        )}
      </div>
      {current && pages && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="space-y-2">
            <canvas
              ref={canvas}
              className="w-full max-w-xl rounded-sm border shadow-md"
              role="img"
              aria-label={t('workshop.handletter.preview')}
              data-testid="handletter-canvas"
            />
            {pages.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {pages.map((_, i) => (
                  <Button
                    key={i}
                    size="sm"
                    variant={i === shownPage ? 'default' : 'outline'}
                    onClick={() => setPage(i)}
                    aria-label={t('workshop.handletter.page', { page: i + 1 })}
                  >
                    {i + 1}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="letter-text">{t('workshop.handletter.text')}</Label>
              <textarea
                id="letter-text"
                value={text}
                rows={8}
                onChange={(e) => setText(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              />
              {missing.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t('workshop.handletter.missing', { chars: missing.join(' ') })}
                </p>
              )}
            </div>
            {slider(
              t('workshop.handletter.size', { value: size.toFixed(1) }),
              size,
              5,
              14,
              0.5,
              setSize,
            )}
            {slider(
              t('workshop.handletter.spacing', { value: spacing.toFixed(2) }),
              spacing,
              1,
              2,
              0.05,
              setSpacing,
            )}
            {slider(
              t('workshop.handletter.wobble', { value: Math.round(wobble * 100) }),
              wobble,
              0,
              1,
              0.05,
              setWobble,
            )}
            <div className="space-y-1">
              <Label>{t('workshop.handletter.ink')}</Label>
              <div
                className="flex flex-wrap gap-2"
                role="radiogroup"
                aria-label={t('workshop.handletter.ink')}
              >
                {(Object.keys(LETTER_INKS) as LetterInk[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={ink === k}
                    onClick={() => setInk(k)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
                      ink === k ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                    )}
                  >
                    <span className="size-3 rounded-full" style={{ background: LETTER_INKS[k] }} />
                    {t(`workshop.handletter.inks.${k}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t('workshop.handletter.paper')}</Label>
              <div
                className="flex flex-wrap gap-2"
                role="radiogroup"
                aria-label={t('workshop.handletter.paper')}
              >
                {LETTER_PAPERS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={paper === k}
                    onClick={() => setPaper(k)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm',
                      paper === k ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                    )}
                  >
                    {t(`workshop.handletter.papers.${k}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setSeed((s) => s + 1)}>
                <ShuffleIcon aria-hidden="true" />
                {t('workshop.handletter.reroll')}
              </Button>
              <Button onClick={() => void pdf()} disabled={busy}>
                {busy ? (
                  <Loader2Icon
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <DownloadIcon aria-hidden="true" />
                )}
                {t('workshop.handletter.download', { count: pages.length })}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
