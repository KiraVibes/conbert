import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon } from 'lucide-react';
import {
  extractPalette,
  paletteFile,
  PALETTE_EXPORTS,
  textOn,
  type PaletteColor,
  type PaletteExport,
} from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { CopyButton } from '../CopyButton';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { useObjectUrl } from '../thumbs/thumb-image';

/** Pixels of a picture, at most 400 on the longest side (plenty for colours). */
async function smallPixels(file: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(file);
  const f = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * f));
  const h = Math.max(1, Math.round(bitmap.height * f));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return ctx.getImageData(0, 0, w, h).data;
}

const MIME: Record<PaletteExport, string> = {
  css: 'text/css',
  scss: 'text/x-scss',
  json: 'application/json',
  gpl: 'text/plain',
  txt: 'text/plain',
};

/** Farbpalette – the main colours of a picture, as codes and palette files. */
export function PaletteTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [pixels, setPixels] = useState<{ file: File; px: Uint8ClampedArray } | null>(null);
  const [count, setCount] = useState(6);
  const [format, setFormat] = useState<PaletteExport>('css');
  const [failed, setFailed] = useState<File | null>(null);
  const url = useObjectUrl(file);

  useEffect(() => {
    if (!file) return;
    let active = true;
    smallPixels(file)
      .then((px) => active && setPixels({ file, px }))
      .catch((e: unknown) => {
        console.error(e);
        if (active) setFailed(file);
      });
    return () => {
      active = false;
    };
  }, [file]);

  const colors: PaletteColor[] = useMemo(
    () => (pixels && pixels.file === file ? extractPalette(pixels.px, count) : []),
    [pixels, file, count],
  );
  const base = file?.name.replace(/\.[^.]+$/, '') ?? 'palette';
  const text = colors.length ? paletteFile(colors, format, base) : '';

  return (
    <div className="space-y-4">
      <HowItWorks trick="palette" />
      <SingleFile file={file} onFile={setFile} />
      {file && failed === file && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.palette.failed')}
        </p>
      )}
      {colors.length > 0 && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {url && (
              <img
                src={url}
                alt={t('workshop.palette.picture')}
                className="max-h-80 w-full rounded-lg border object-contain"
              />
            )}
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>{t('workshop.palette.count', { count })}</Label>
                <Slider
                  min={2}
                  max={12}
                  step={1}
                  value={[count]}
                  onValueChange={([v]) => setCount(v ?? 6)}
                  aria-label={t('workshop.palette.count', { count })}
                />
              </div>
              {/* How much of the picture each colour covers. */}
              <div
                className="flex h-6 overflow-hidden rounded-md border"
                role="img"
                aria-label={t('workshop.palette.bar')}
              >
                {colors.map((c) => (
                  <div key={c.hex} style={{ background: c.hex, width: `${c.share * 100}%` }} />
                ))}
              </div>
            </div>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="palette-colors">
            {colors.map((c) => (
              <li key={c.hex} className="flex items-center gap-3 rounded-lg border p-2">
                <span
                  className="flex size-14 shrink-0 items-center justify-center rounded-md border text-xs font-medium"
                  style={{ background: c.hex, color: textOn(c) }}
                >
                  {Math.round(c.share * 100)} %
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-mono font-medium">{c.hex.toUpperCase()}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    rgb({c.r}, {c.g}, {c.b})
                  </span>
                </span>
                <CopyButton text={c.hex} label={t('workshop.palette.copy')} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="palette-format">{t('workshop.palette.format')}</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as PaletteExport)}>
                <SelectTrigger id="palette-format" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PALETTE_EXPORTS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {t(`workshop.palette.formats.${f}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                saveBlob(new Blob([text], { type: MIME[format] }), `${base}-palette.${format}`)
              }
            >
              <DownloadIcon aria-hidden="true" />
              {t('workshop.palette.download')}
            </Button>
            <CopyButton text={text} label={t('workshop.palette.copyAll')} />
          </div>
          <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}
