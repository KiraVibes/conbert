import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, Loader2Icon, StickerIcon } from 'lucide-react';
import { addOutline, opaqueBox, removeFlatBackground } from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useAvailableEngines } from '@/engines/use-engines';
import { convertOnServer } from '@/engines/server-convert';
import { useCan } from '@/features/auth/use-auth';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { useObjectUrl } from '../thumbs/thumb-image';

const SIZE = 512;
/** WhatsApp takes static stickers up to 100 KB. */
const MAX_WEBP = 100 * 1024;
const BACKGROUNDS = ['keep', 'flat', 'ai'] as const;
type Background = (typeof BACKGROUNDS)[number];

async function pixelsOf(blob: Blob, maxSide: number) {
  const bitmap = await createImageBitmap(blob);
  const f = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * f));
  const h = Math.max(1, Math.round(bitmap.height * f));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

async function makeSticker(
  file: File,
  background: Background,
  edge: number,
  edgeColor: 'white' | 'black',
): Promise<{ webp: Blob; png: Blob }> {
  const source =
    background === 'ai'
      ? await convertOnServer({
          file,
          fileName: file.name,
          outputExt: 'png',
          options: { removeBackground: true },
        })
      : file;
  const img = await pixelsOf(source, 1400);
  if (background === 'flat') removeFlatBackground(img.data, img.w, img.h);
  const box = opaqueBox(img.data, img.w, img.h) ?? { x: 0, y: 0, w: img.w, h: img.h };
  // The shape, cut to its box, fitted into the sticker with room for the edge.
  const cut = new OffscreenCanvas(box.w, box.h);
  cut.getContext('2d')?.putImageData(new ImageData(img.data, img.w, img.h), -box.x, -box.y);
  const room = SIZE - 2 * (edge + 8);
  const f = Math.min(room / box.w, room / box.h);
  const w = Math.round(box.w * f);
  const h = Math.round(box.h * f);
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  ctx.drawImage(cut, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  if (edge > 0) {
    const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const color: [number, number, number] = edgeColor === 'white' ? [255, 255, 255] : [20, 20, 20];
    ctx.putImageData(new ImageData(addOutline(px, SIZE, SIZE, edge, color), SIZE, SIZE), 0, 0);
  }
  let webp = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 });
  for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) {
    if (webp.size <= MAX_WEBP) break;
    webp = await canvas.convertToBlob({ type: 'image/webp', quality: q });
  }
  return { webp, png: await canvas.convertToBlob({ type: 'image/png' }) };
}

/** Sticker-Macher – a picture as a messenger sticker with a white edge. */
export function StickerTool() {
  const { t } = useTranslation();
  const { engines, serverAvailable } = useAvailableEngines();
  const aiAllowed = useCan('ai');
  const aiReady =
    serverAvailable &&
    aiAllowed &&
    engines.some((e) => e.id === 'image-ai' && e.runtime === 'server' && e.status !== 'error');
  const [file, setFile] = useState<File | null>(null);
  const [background, setBackground] = useState<Background>('flat');
  const [edge, setEdge] = useState(10);
  const [edgeColor, setEdgeColor] = useState<'white' | 'black'>('white');
  const [result, setResult] = useState<{ webp: Blob; png: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = useObjectUrl(result?.png ?? null);

  async function make() {
    if (!file) return;
    setBusy(true);
    setFailed(false);
    try {
      setResult(await makeSticker(file, background, edge, edgeColor));
    } catch (e) {
      console.error(e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const base = file?.name.replace(/\.[^.]+$/, '') ?? 'sticker';
  return (
    <div className="space-y-4">
      <HowItWorks trick="sticker" />
      <SingleFile
        file={file}
        onFile={(f) => {
          setFile(f);
          setResult(null);
        }}
      />
      <div className="space-y-2">
        <Label>{t('workshop.sticker.background')}</Label>
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label={t('workshop.sticker.background')}
        >
          {BACKGROUNDS.filter((b) => b !== 'ai' || aiReady).map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={background === b}
              onClick={() => setBackground(b)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                background === b ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
              )}
            >
              {t(`workshop.sticker.backgrounds.${b}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t(`workshop.sticker.backgroundHints.${background}`)}
        </p>
      </div>
      <div className="grid max-w-lg gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('workshop.sticker.edge', { value: edge })}</Label>
          <Slider
            min={0}
            max={20}
            step={1}
            value={[edge]}
            onValueChange={([v]) => setEdge(v ?? 10)}
            aria-label={t('workshop.sticker.edgeLabel')}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('workshop.sticker.edgeColor')}</Label>
          <div className="flex gap-2">
            {(['white', 'black'] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={edgeColor === c}
                onClick={() => setEdgeColor(c)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm',
                  edgeColor === c ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
                )}
              >
                {t(`workshop.sticker.colors.${c}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <Button onClick={() => void make()} disabled={!file || busy}>
        {busy ? (
          <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <StickerIcon aria-hidden="true" />
        )}
        {t('workshop.sticker.make')}
      </Button>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.sticker.failed')}
        </p>
      )}
      {result && url && (
        <div className="space-y-2" data-testid="sticker-result">
          <img
            src={url}
            alt={t('workshop.sticker.previewAlt')}
            className="size-64 rounded-lg border bg-[repeating-conic-gradient(#ccc_0_25%,#fff_0_50%)] bg-[length:20px_20px]"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => saveBlob(result.webp, `${base}-sticker.webp`)}
            >
              <DownloadIcon aria-hidden="true" />
              {t('workshop.sticker.webp', { kb: Math.ceil(result.webp.size / 1024) })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => saveBlob(result.png, `${base}-sticker.png`)}
            >
              <DownloadIcon aria-hidden="true" />
              {t('workshop.sticker.png')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('workshop.sticker.howToUse')}</p>
        </div>
      )}
    </div>
  );
}
