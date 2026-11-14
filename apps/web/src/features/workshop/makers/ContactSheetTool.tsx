import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, LayoutGridIcon, Loader2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatBytes } from '@/lib/format-bytes';
import { cn } from '@/lib/utils';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';
import { useObjectUrl } from '../thumbs/thumb-image';

const GRIDS = [3, 4, 5, 6, 8] as const;
const KINDS = ['sheet', 'sprite'] as const;
type Kind = (typeof KINDS)[number];

const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
};

async function makeSheet(file: File, grid: number, kind: Kind, header: string): Promise<Blob> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no video track');
  const duration = await track.computeDuration();
  const count = grid * grid;
  // Evenly spread, a little away from the very start and end.
  const times = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * duration);
  const tileW = kind === 'sprite' ? 256 : Math.round(1600 / grid);
  const tileH = Math.round((tileW * track.displayHeight) / Math.max(1, track.displayWidth));
  const gap = kind === 'sprite' ? 0 : 6;
  const top = kind === 'sprite' ? 0 : 56;
  const canvas = new OffscreenCanvas(
    grid * tileW + (grid + 1) * gap,
    top + grid * tileH + (grid + 1) * gap,
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  if (kind === 'sheet') {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#eee';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(file.name, gap * 2, 26);
    ctx.font = '15px sans-serif';
    ctx.fillStyle = '#aaa';
    ctx.fillText(header, gap * 2, 48);
  }
  const sink = new mb.CanvasSink(track, { width: tileW, height: tileH, fit: 'fill' });
  let i = 0;
  for await (const frame of sink.canvasesAtTimestamps(times)) {
    const x = gap + (i % grid) * (tileW + gap);
    const y = top + gap + Math.floor(i / grid) * (tileH + gap);
    if (frame) ctx.drawImage(frame.canvas, x, y, tileW, tileH);
    if (kind === 'sheet') {
      const label = clock(times[i] ?? 0);
      ctx.font = 'bold 14px monospace';
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x + tileW - w - 4, y + tileH - 22, w, 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + tileW - w + 1, y + tileH - 8);
    }
    i++;
  }
  return canvas.convertToBlob(
    kind === 'sprite' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.9 },
  );
}

/** Kontaktabzug – a video as one picture of evenly spread frames (or a sprite sheet). */
export function ContactSheetTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [grid, setGrid] = useState(4);
  const [kind, setKind] = useState<Kind>('sheet');
  const [result, setResult] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = useObjectUrl(result);

  async function make() {
    if (!file) return;
    setBusy(true);
    setFailed(false);
    try {
      setResult(await makeSheet(file, grid, kind, formatBytes(file.size, i18n.language)));
    } catch (e) {
      console.error(e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <HowItWorks trick="contactsheet" />
      <SingleFile
        file={file}
        onFile={(f) => {
          setFile(f);
          setResult(null);
        }}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="sheet-grid">{t('workshop.contactsheet.grid')}</Label>
          <Select value={String(grid)} onValueChange={(v) => setGrid(Number(v))}>
            <SelectTrigger id="sheet-grid" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRIDS.map((g) => (
                <SelectItem key={g} value={String(g)}>
                  {t('workshop.contactsheet.gridValue', { n: g, count: g * g })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label={t('workshop.contactsheet.kind')}
        >
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                kind === k ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
              )}
            >
              {t(`workshop.contactsheet.kinds.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(`workshop.contactsheet.kindHints.${kind}`)}
      </p>
      <Button onClick={() => void make()} disabled={!file || busy}>
        {busy ? (
          <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <LayoutGridIcon aria-hidden="true" />
        )}
        {t('workshop.contactsheet.make')}
      </Button>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.contactsheet.failed')}
        </p>
      )}
      {result && url && (
        <div className="space-y-2" data-testid="contactsheet-result">
          <img
            src={url}
            alt={t('workshop.contactsheet.previewAlt')}
            className="w-full rounded border"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              saveBlob(
                result,
                `${file?.name.replace(/\.[^.]+$/, '') ?? 'video'}-${kind === 'sprite' ? 'sprites.png' : 'kontaktabzug.jpg'}`,
              )
            }
          >
            <DownloadIcon aria-hidden="true" />
            {t('workshop.contactsheet.download')}
          </Button>
        </div>
      )}
    </div>
  );
}
