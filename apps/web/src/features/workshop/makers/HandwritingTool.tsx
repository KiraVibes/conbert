import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, FileDownIcon, Loader2Icon } from 'lucide-react';
import { cellWritingArea, cleanFontName, HANDWRITING_CHARS } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { HandwritingResult } from '@/workers/forensics.worker';
import { pdfPagesAsImages } from '../carriers/paper';
import { withForensics } from '../forensics/forensics-worker';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { buildFont, makeHandwritingSheet, type BuiltFont } from './handwriting-font';

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
      ctx.strokeStyle = current.glyphs[i] ? 'rgba(22,163,74,0.9)' : 'rgba(150,150,150,0.6)';
      ctx.strokeRect(
        (a.x - originMm[0]) * pxPerMm,
        (a.y - originMm[1]) * pxPerMm,
        a.w * pxPerMm,
        a.h * pxPerMm,
      );
    });
  }, [current]);

  const found = current ? current.glyphs.filter(Boolean).length : 0;
  return (
    <div className="space-y-4">
      <HowItWorks trick="handfont" />
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>{t('workshop.handfont.steps.print')}</li>
        <li>{t('workshop.handfont.steps.write')}</li>
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
