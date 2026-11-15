import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon } from 'lucide-react';
import {
  addFrame,
  backlitPreview,
  DEFAULT_RELIEF,
  heightfieldStl,
  RELIEF_MODES,
  RELIEF_STEP_MM,
  reliefGrid,
  reliefHeights,
  type ReliefOptions,
} from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ModelPreview } from '@/features/preview/ModelPreview';
import { formatBytes } from '@/lib/format-bytes';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';

interface Sampled {
  file: File;
  cols: number;
  rows: number;
  gray: Uint8Array;
  alpha: Uint8Array;
}

/** The picture at the grid size, as grey values and alpha. */
async function sample(file: File, widthMm: number): Promise<Sampled> {
  const bitmap = await createImageBitmap(file);
  const { cols, rows } = reliefGrid(bitmap.width, bitmap.height, widthMm);
  const canvas = new OffscreenCanvas(cols, rows);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  ctx.drawImage(bitmap, 0, 0, cols, rows);
  bitmap.close();
  const px = ctx.getImageData(0, 0, cols, rows).data;
  const gray = new Uint8Array(cols * rows);
  const alpha = new Uint8Array(cols * rows);
  for (let i = 0; i < gray.length; i++) {
    gray[i] =
      ((px[i * 4] ?? 0) * 299 + (px[i * 4 + 1] ?? 0) * 587 + (px[i * 4 + 2] ?? 0) * 114) / 1000;
    alpha[i] = px[i * 4 + 3] ?? 255;
  }
  return { file, cols, rows, gray, alpha };
}

function NumberSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v ?? value)}
        aria-label={label}
      />
    </div>
  );
}

/** Lithophane & Relief – a picture as a 3D-printable plate. */
export function LithophaneTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [o, setO] = useState<ReliefOptions>(DEFAULT_RELIEF);
  // The sliders move freely; the model follows a moment later.
  const [settled, setSettled] = useState<ReliefOptions>(DEFAULT_RELIEF);
  const [sampled, setSampled] = useState<Sampled | null>(null);
  const [failed, setFailed] = useState<File | null>(null);
  const backlit = useRef<HTMLCanvasElement>(null);
  const set = (patch: Partial<ReliefOptions>) => setO((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const id = setTimeout(() => setSettled(o), 350);
    return () => clearTimeout(id);
  }, [o]);

  useEffect(() => {
    if (!file) return;
    let active = true;
    sample(file, settled.widthMm)
      .then((s) => active && setSampled(s))
      .catch((e: unknown) => {
        console.error(e);
        if (active) setFailed(file);
      });
    return () => {
      active = false;
    };
  }, [file, settled.widthMm]);

  const model = useMemo(() => {
    if (!sampled || sampled.file !== file) return null;
    const step = settled.widthMm / sampled.cols;
    const plate = reliefHeights(sampled.gray, sampled.alpha, sampled.cols, sampled.rows, settled);
    const frameH = settled.mode === 'lithophane' ? settled.maxMm : settled.baseMm + settled.raiseMm;
    const framed = addFrame(
      plate,
      sampled.cols,
      sampled.rows,
      Math.round(settled.frameMm / step),
      frameH,
    );
    const stl = heightfieldStl(framed.heights, framed.cols, framed.rows, step);
    return {
      plate,
      cols: sampled.cols,
      rows: sampled.rows,
      blob: new Blob([stl as Uint8Array<ArrayBuffer>], { type: 'model/stl' }),
      widthMm: (framed.cols - 1) * step,
      heightMm: (framed.rows - 1) * step,
      key: `${file?.name}-${JSON.stringify(settled)}`,
    };
  }, [sampled, file, settled]);

  useEffect(() => {
    const c = backlit.current;
    if (!c || !model || settled.mode !== 'lithophane') return;
    const light = backlitPreview(model.plate, settled.minMm, settled.maxMm);
    c.width = model.cols;
    c.height = model.rows;
    const img = new ImageData(model.cols, model.rows);
    for (let i = 0; i < light.length; i++) {
      // Warm light shining through white plastic.
      const v = light[i] ?? 0;
      img.data.set([v, Math.round(v * 0.93), Math.round(v * 0.8), 255], i * 4);
    }
    c.getContext('2d')?.putImageData(img, 0, 0);
  }, [model, settled]);

  const base = file?.name.replace(/\.[^.]+$/, '') ?? 'relief';
  const mm = (v: number) => v.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  return (
    <div className="space-y-4">
      <HowItWorks trick="lithophane" />
      <SingleFile file={file} onFile={setFile} />
      {file && failed === file && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.lithophane.failed')}
        </p>
      )}
      <div className="space-y-2">
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label={t('workshop.lithophane.mode')}
        >
          {RELIEF_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={o.mode === m}
              onClick={() => set({ mode: m })}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                o.mode === m ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
              )}
            >
              {t(`workshop.lithophane.modes.${m}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t(`workshop.lithophane.modeHelp.${o.mode}`)}
        </p>
      </div>
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <NumberSlider
          label={t('workshop.lithophane.width', { value: mm(o.widthMm) })}
          value={o.widthMm}
          min={40}
          max={200}
          step={5}
          onChange={(v) => set({ widthMm: v })}
        />
        <NumberSlider
          label={t('workshop.lithophane.frame', { value: mm(o.frameMm) })}
          value={o.frameMm}
          min={0}
          max={10}
          step={0.5}
          onChange={(v) => set({ frameMm: v })}
        />
        {o.mode === 'lithophane' ? (
          <>
            <NumberSlider
              label={t('workshop.lithophane.min', { value: mm(o.minMm) })}
              value={o.minMm}
              min={0.4}
              max={2}
              step={0.1}
              onChange={(v) => set({ minMm: v, maxMm: Math.max(o.maxMm, v + 0.5) })}
            />
            <NumberSlider
              label={t('workshop.lithophane.max', { value: mm(o.maxMm) })}
              value={o.maxMm}
              min={1}
              max={6}
              step={0.1}
              onChange={(v) => set({ maxMm: v, minMm: Math.min(o.minMm, v - 0.5) })}
            />
          </>
        ) : (
          <>
            <NumberSlider
              label={t('workshop.lithophane.base', { value: mm(o.baseMm) })}
              value={o.baseMm}
              min={0.6}
              max={5}
              step={0.1}
              onChange={(v) => set({ baseMm: v })}
            />
            <NumberSlider
              label={t('workshop.lithophane.raise', { value: mm(o.raiseMm) })}
              value={o.raiseMm}
              min={0.4}
              max={10}
              step={0.1}
              onChange={(v) => set({ raiseMm: v })}
            />
          </>
        )}
        <div className="flex items-center gap-3">
          <Switch
            id="litho-invert"
            checked={o.invert}
            onCheckedChange={(v) => set({ invert: v })}
          />
          <Label htmlFor="litho-invert">{t('workshop.lithophane.invert')}</Label>
        </div>
      </div>
      {model && (
        <div className="space-y-3">
          <div
            className={cn(
              'grid gap-4',
              settled.mode === 'lithophane' && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
            )}
          >
            <ModelPreview
              source={{ key: model.key, blob: model.blob, ext: 'stl', name: `${base}.stl` }}
            />
            {settled.mode === 'lithophane' && (
              <figure className="space-y-1">
                <canvas
                  ref={backlit}
                  className="w-full rounded-lg border bg-black"
                  role="img"
                  aria-label={t('workshop.lithophane.backlit')}
                />
                <figcaption className="text-xs text-muted-foreground">
                  {t('workshop.lithophane.backlit')}
                </figcaption>
              </figure>
            )}
          </div>
          <p className="text-sm">
            {t('workshop.lithophane.size', {
              width: mm(model.widthMm),
              height: mm(model.heightMm),
              file: formatBytes(model.blob.size, i18n.language),
              step: RELIEF_STEP_MM.toLocaleString(i18n.language),
            })}
          </p>
          <Button onClick={() => saveBlob(model.blob, `${base}-${settled.mode}.stl`)}>
            <DownloadIcon aria-hidden="true" />
            {t('workshop.lithophane.download')}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t(`workshop.lithophane.printTips.${settled.mode}`)}
          </p>
        </div>
      )}
    </div>
  );
}
