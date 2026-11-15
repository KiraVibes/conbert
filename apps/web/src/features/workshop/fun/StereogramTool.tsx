import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, EyeIcon, ShuffleIcon } from 'lucide-react';
import {
  depthFromGray,
  guideDotDistance,
  stereogram,
  STEREO_PATTERNS,
  type StereoPattern,
} from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';

const SOURCES = ['text', 'image'] as const;
type Source = (typeof SOURCES)[number];
/** Picture shape: 3 : 2. */
const ASPECT = 2 / 3;

function Chips<T extends string>(p: {
  label: string;
  values: readonly T[];
  value: T;
  onChange: (v: T) => void;
  text: (v: T) => string;
}) {
  return (
    <div className="space-y-1">
      <Label>{p.label}</Label>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={p.label}>
        {p.values.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={p.value === v}
            onClick={() => p.onChange(v)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              p.value === v ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
            )}
          >
            {p.text(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Greyscale of a canvas. */
function grayOf(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): Uint8Array {
  const px = ctx.getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++)
    g[i] =
      ((px[i * 4] ?? 0) * 299 + (px[i * 4 + 1] ?? 0) * 587 + (px[i * 4 + 2] ?? 0) * 114) / 1000;
  return g;
}

/** Depth from a text: big white letters on black. */
function textDepth(text: string, w: number, h: number): Uint8Array {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split('\n').slice(0, 4);
  let size = h / (lines.length * 1.15);
  ctx.font = `900 ${size}px Arial, Helvetica, sans-serif`;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
  size = Math.min(size, (size * w * 0.85) / widest);
  ctx.font = `900 ${size}px Arial, Helvetica, sans-serif`;
  lines.forEach((l, i) =>
    ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.1),
  );
  return grayOf(ctx, w, h);
}

/** A picture drawn into w×h (covering), as greyscale or as RGBA. */
async function picture(file: Blob, w: number, h: number) {
  const bmp = await createImageBitmap(file);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  const f = Math.max(w / bmp.width, h / bmp.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(
    bmp,
    (w - bmp.width * f) / 2,
    (h - bmp.height * f) / 2,
    bmp.width * f,
    bmp.height * f,
  );
  bmp.close();
  return { gray: grayOf(ctx, w, h), rgba: ctx.getImageData(0, 0, w, h).data };
}

/** Magic-Eye-Bild – a hidden 3D shape in a picture of dots or a pattern. */
export function StereogramTool() {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source>('text');
  const [text, setText] = useState('3D');
  const [file, setFile] = useState<File | null>(null);
  const [pattern, setPattern] = useState<StereoPattern>('color');
  const [tileFile, setTileFile] = useState<File | null>(null);
  const [width, setWidth] = useState(1200);
  const [depth, setDepth] = useState(0.33);
  const [invert, setInvert] = useState(false);
  const [solution, setSolution] = useState(false);
  const [seed, setSeed] = useState(7);
  const [shape, setShape] = useState<{ key: string; gray: Uint8Array } | null>(null);
  const [tile, setTile] = useState<{
    file: File;
    rgba: Uint8ClampedArray;
    width: number;
    height: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const height = Math.round(width * ASPECT);
  const eyeSep = Math.round((width * 2) / 9);
  const shapeKey = `${source}|${source === 'text' ? text : (file?.name ?? '')}|${width}`;

  // The shape (grey: bright = near).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const gray =
          source === 'text'
            ? textDepth(text || ' ', width, height)
            : file
              ? (await picture(file, width, height)).gray
              : null;
        if (active && gray) {
          setShape({ key: shapeKey, gray });
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
  }, [source, text, file, width, height, shapeKey]);

  // An own pattern: a strip as wide as the repeat distance.
  useEffect(() => {
    if (!tileFile) return;
    let active = true;
    const tw = guideDotDistance(eyeSep);
    const th = Math.round(tw * 1.5);
    picture(tileFile, tw, th)
      .then((p) => active && setTile({ file: tileFile, rgba: p.rgba, width: tw, height: th }))
      .catch((e: unknown) => console.error(e));
    return () => {
      active = false;
    };
  }, [tileFile, eyeSep]);

  const usableTile =
    tile && tile.file === tileFile && tile.width === guideDotDistance(eyeSep) ? tile : null;
  const result = useMemo(() => {
    if (!shape || shape.key !== shapeKey) return null;
    const map = depthFromGray(shape.gray, width, height, invert);
    if (solution) {
      const out = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < map.length; i++) {
        const v = Math.round((map[i] ?? 0) * 255);
        out.set([v, v, v, 255], i * 4);
      }
      return out;
    }
    const usePattern = pattern === 'image' && !usableTile ? 'color' : pattern;
    const img = stereogram(map, width, height, {
      eyeSep,
      depth,
      pattern: usePattern,
      tile: usableTile,
      seed,
    });
    // Two help dots at the top: let them become three, then the picture appears.
    const d = guideDotDistance(eyeSep);
    const r = Math.max(4, Math.round(width / 200));
    for (const cx of [width / 2 - d / 2, width / 2 + d / 2])
      for (let y = -r; y <= r; y++)
        for (let x = -r; x <= r; x++) {
          if (x * x + y * y > r * r) continue;
          const px = Math.round(cx + x);
          const py = r * 3 + y;
          img.set([0, 0, 0, 255], (py * width + px) * 4);
        }
    return img;
  }, [shape, shapeKey, width, height, invert, solution, pattern, usableTile, eyeSep, depth, seed]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !result) return;
    c.width = width;
    c.height = height;
    c.getContext('2d')?.putImageData(new ImageData(result, width, height), 0, 0);
  }, [result, width, height]);

  function download() {
    canvas.current?.toBlob(
      (b) => b && saveBlob(b, `magic-eye-${(text || 'bild').replace(/[^\w-]+/g, '_')}.png`),
      'image/png',
    );
  }

  return (
    <div className="space-y-4">
      <HowItWorks trick="stereogram" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="space-y-2">
          {result ? (
            <canvas
              ref={canvas}
              className="w-full rounded-lg border"
              role="img"
              aria-label={t(
                solution ? 'workshop.stereogram.solutionAlt' : 'workshop.stereogram.pictureAlt',
              )}
              data-testid="stereogram-canvas"
            />
          ) : (
            <p className="rounded-lg border p-6 text-sm text-muted-foreground">
              {t('workshop.stereogram.empty')}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{t('workshop.stereogram.howToSee')}</p>
        </div>
        <div className="space-y-4">
          <Chips
            label={t('workshop.stereogram.source')}
            values={SOURCES}
            value={source}
            onChange={setSource}
            text={(v) => t(`workshop.stereogram.sources.${v}`)}
          />
          {source === 'text' ? (
            <div className="space-y-1">
              <Label htmlFor="stereo-text">{t('workshop.stereogram.text')}</Label>
              <Input
                id="stereo-text"
                value={text}
                maxLength={24}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-1">
              <SingleFile file={file} onFile={setFile} />
              <p className="text-xs text-muted-foreground">{t('workshop.stereogram.imageHelp')}</p>
            </div>
          )}
          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {t('workshop.stereogram.failed')}
            </p>
          )}
          <Chips
            label={t('workshop.stereogram.pattern')}
            values={STEREO_PATTERNS}
            value={pattern}
            onChange={setPattern}
            text={(v) => t(`workshop.stereogram.patterns.${v}`)}
          />
          {pattern === 'image' && (
            <div className="space-y-1">
              <SingleFile file={tileFile} onFile={setTileFile} />
              <p className="text-xs text-muted-foreground">
                {t('workshop.stereogram.patternHelp')}
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label>{t('workshop.stereogram.depth', { value: Math.round(depth * 100) })}</Label>
            <Slider
              min={0.15}
              max={0.45}
              step={0.01}
              value={[depth]}
              onValueChange={([v]) => setDepth(v ?? depth)}
              aria-label={t('workshop.stereogram.depth', { value: Math.round(depth * 100) })}
            />
            <p className="text-xs text-muted-foreground">{t('workshop.stereogram.depthHelp')}</p>
          </div>
          <div className="space-y-2">
            <Label>{t('workshop.stereogram.width', { value: width })}</Label>
            <Slider
              min={600}
              max={2400}
              step={100}
              value={[width]}
              onValueChange={([v]) => setWidth(v ?? width)}
              aria-label={t('workshop.stereogram.width', { value: width })}
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch id="stereo-invert" checked={invert} onCheckedChange={setInvert} />
            <Label htmlFor="stereo-invert">{t('workshop.stereogram.invert')}</Label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSeed((s) => s + 1)}
              disabled={pattern === 'image'}
            >
              <ShuffleIcon aria-hidden="true" />
              {t('workshop.stereogram.reroll')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSolution((s) => !s)}
              aria-pressed={solution}
            >
              <EyeIcon aria-hidden="true" />
              {t(
                solution ? 'workshop.stereogram.hideSolution' : 'workshop.stereogram.showSolution',
              )}
            </Button>
          </div>
          <Button onClick={download} disabled={!result || solution}>
            <DownloadIcon aria-hidden="true" />
            {t('workshop.stereogram.download')}
          </Button>
        </div>
      </div>
    </div>
  );
}
