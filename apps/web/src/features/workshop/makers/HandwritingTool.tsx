import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, FileDownIcon, Loader2Icon } from 'lucide-react';
import { cellBox, cellWritingArea, cleanFontName, HANDWRITING_CHARS, SHEET } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { HandwritingResult } from '@/workers/forensics.worker';
import { pdfPagesAsImages } from '../carriers/paper';
import { withForensics } from '../forensics/forensics-worker';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { buildFont, makeHandwritingSheet, type BuiltFont } from './handwriting-font';

const RULES = ['capital', 'small', 'descender', 'frame'] as const;

/** One box of the sheet with "Hxg" written the right size, and the rules next to it. */
function WritingExample() {
  const { t } = useTranslation();
  const b = cellBox(0);
  const a = cellWritingArea(0);
  const base = a.y + a.h * SHEET.baseline;
  const xh = a.y + a.h * SHEET.xHeight;
  // Helvetica/Arial: cap height 0.72, x-height 0.52 of the font size.
  const cap = (base - a.y - 1) / 0.718;
  const small = (base - xh) / 0.523;
  const blue = '#9ec5ff';
  return (
    <div className="mt-2 mb-1 flex flex-wrap items-center gap-4">
      <svg
        viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
        className="h-32 shrink-0 rounded-sm"
        role="img"
        aria-label={t('workshop.handfont.exampleAlt')}
      >
        <rect
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill="#ffffff"
          stroke="#c8c8c8"
          strokeWidth={0.2}
        />
        <rect x={b.x} y={b.y} width={b.w} height={SHEET.label} fill="#ededed" />
        <text
          x={b.x + 1.2}
          y={b.y + 3.1}
          fontSize={2.8}
          fill="#8c8c8c"
          fontFamily="Arial, Helvetica, sans-serif"
        >
          {t('workshop.handfont.sheet.example')}
        </text>
        <rect
          x={a.x}
          y={a.y}
          width={a.w}
          height={a.h}
          fill="none"
          stroke={blue}
          strokeWidth={0.18}
        />
        <line x1={a.x} x2={a.x + a.w} y1={base} y2={base} stroke={blue} strokeWidth={0.22} />
        <line
          x1={a.x}
          x2={a.x + a.w}
          y1={xh}
          y2={xh}
          stroke={blue}
          strokeWidth={0.15}
          strokeDasharray="0.7 0.7"
        />
        <text x={a.x + 1.5} y={base} fill="#1a237e" fontFamily="Arial, Helvetica, sans-serif">
          <tspan fontSize={cap}>H</tspan>
          <tspan fontSize={small}>xg</tspan>
        </text>
      </svg>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {RULES.map((r) => (
          <li key={r}>• {t(`workshop.handfont.rules.${r}`)}</li>
        ))}
      </ul>
    </div>
  );
}

/** Eigene Handschrift als Schrift – fill in a sheet, photograph it, get a font. */
export function HandwritingTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ file: File; r: HandwritingResult | null } | null>(null);
  const [failed, setFailed] = useState<File | null>(null);
  const [name, setName] = useState(t('workshop.handfont.defaultName'));
  const [font, setFont] = useState<BuiltFont | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [sample, setSample] = useState(t('workshop.handfont.sample'));
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = result && result.file === file ? result.r : undefined;

  async function sheet() {
    const pdf = await makeHandwritingSheet({
      title: t('workshop.handfont.sheet.title'),
      instructions: t('workshop.handfont.sheet.instructions'),
      footer: t('workshop.handfont.sheet.footer'),
      example: t('workshop.handfont.sheet.example'),
      exampleHelp: RULES.map((r) => `• ${t(`workshop.handfont.rules.${r}`)}`).join('\n'),
    });
    saveBlob(
      new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
      t('workshop.handfont.sheet.file'),
    );
  }

  // Read the sheet in the worker.
  useEffect(() => {
    if (!file) return;
    let active = true;
    void (async () => {
      try {
        const picture = file.type === 'application/pdf' ? (await pdfPagesAsImages(file))[0] : file;
        if (!picture) throw new Error('no page');
        const r = await withForensics((api) => api.handwriting(picture));
        if (active) setResult({ file, r });
      } catch (e) {
        console.error(e);
        if (active) setFailed(file);
      }
    })();
    return () => {
      active = false;
    };
  }, [file]);

  // Build the font whenever the glyphs or the name change.
  useEffect(() => {
    if (!current) return;
    let active = true;
    buildFont(current.glyphs, name)
      .then((f) => active && setFont(f))
      .catch((e: unknown) => console.error(e));
    return () => {
      active = false;
    };
  }, [current, name]);

  // Load the font into the page for the preview.
  useEffect(() => {
    if (!font) return;
    const fam = `conbert-hand-${Math.random().toString(36).slice(2)}`;
    const face = new FontFace(fam, font.otf);
    let added = false;
    face
      .load()
      .then(() => {
        document.fonts.add(face);
        added = true;
        setFamily(fam);
      })
      .catch((e: unknown) => console.error(e));
    return () => {
      if (added) document.fonts.delete(face);
    };
  }, [font]);

  // The straightened sheet with found (green) and empty (grey) boxes.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !current) return;
    const { gray, width, height, pxPerMm, originMm } = current.page;
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = new ImageData(width, height);
    for (let i = 0; i < gray.length; i++) {
      const v = gray[i] ?? 0;
      img.data.set([v, v, v, 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    ctx.lineWidth = 4;
    HANDWRITING_CHARS.forEach((_, i) => {
      const a = cellWritingArea(i);
      const g = current.glyphs[i];
      ctx.strokeStyle = !g
        ? 'rgba(150,150,150,0.6)'
        : g.clipped
          ? 'rgba(217,119,6,0.95)'
          : 'rgba(22,163,74,0.9)';
      ctx.strokeRect(
        (a.x - originMm[0]) * pxPerMm,
        (a.y - originMm[1]) * pxPerMm,
        a.w * pxPerMm,
        a.h * pxPerMm,
      );
    });
  }, [current]);

  const found = current ? current.glyphs.filter(Boolean).length : 0;
  const clipped = current ? HANDWRITING_CHARS.filter((_, i) => current.glyphs[i]?.clipped) : [];
  return (
    <div className="space-y-4">
      <HowItWorks trick="handfont" />
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>{t('workshop.handfont.steps.print')}</li>
        <li>
          {t('workshop.handfont.steps.write')}
          <WritingExample />
        </li>
        <li>{t('workshop.handfont.steps.photo')}</li>
      </ol>
      <Button variant="outline" onClick={() => void sheet()}>
        <FileDownIcon aria-hidden="true" />
        {t('workshop.handfont.getSheet')}
      </Button>
      <SingleFile
        file={file}
        onFile={(f) => {
          setFile(f);
          setFailed(null);
        }}
      />
      {file && current === undefined && failed !== file && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.handfont.working')}
        </p>
      )}
      {file && (failed === file || current === null) && (
        <p role="alert" className="text-sm text-destructive">
          {t(failed === file ? 'workshop.handfont.failed' : 'workshop.handfont.noMarkers')}
        </p>
      )}
      {current && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <figure className="space-y-1">
            <canvas
              ref={canvas}
              className="w-full rounded-lg border"
              role="img"
              aria-label={t('workshop.handfont.read')}
            />
            <figcaption className="text-xs text-muted-foreground">
              {t('workshop.handfont.found', { count: found, total: HANDWRITING_CHARS.length })}
            </figcaption>
          </figure>
          <div className="space-y-3">
            <div className="max-w-sm space-y-1">
              <Label htmlFor="hf-name">{t('workshop.handfont.name')}</Label>
              <Input
                id="hf-name"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hf-sample">{t('workshop.handfont.preview')}</Label>
              <textarea
                id="hf-sample"
                value={sample}
                rows={3}
                onChange={(e) => setSample(e.target.value)}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-3xl leading-snug focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                style={family ? { fontFamily: `"${family}", cursive` } : undefined}
                data-testid="handfont-sample"
              />
            </div>
            {clipped.length > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-400" role="status">
                {t('workshop.handfont.clipped', { chars: clipped.join(' ') })}
              </p>
            )}
            {font && font.missing.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {t('workshop.handfont.missing', { chars: font.missing.join(' ') })}
              </p>
            )}
            {font && font.borrowed.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {t('workshop.handfont.borrowed', { chars: font.borrowed.join(' ') })}
              </p>
            )}
            <Button
              disabled={!font}
              onClick={() =>
                font &&
                saveBlob(
                  new Blob([font.otf], { type: 'font/otf' }),
                  `${cleanFontName(name).replace(/\s+/g, '-')}.otf`,
                )
              }
            >
              <DownloadIcon aria-hidden="true" />
              {t('workshop.handfont.download')}
            </Button>
            <p className="text-sm text-muted-foreground">{t('workshop.handfont.install')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
