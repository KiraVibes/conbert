import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, FilmIcon, Loader2Icon, MinimizeIcon, ScissorsIcon } from 'lucide-react';
import {
  blobReader,
  jpegOrientation,
  shrinkZipImages,
  sizeReport,
  type SizePartKind,
  type SizeReport,
  type SizeTip,
} from '@conbert/core';
import { Button } from '@/components/ui/button';
import { useFiles } from '@/features/convert/files-store';
import { useSettings } from '@/features/settings/settings-store';
import { formatBytes } from '@/lib/format-bytes';
import { HowItWorks, SingleFile } from '../SingleFile';
import { saveBlob } from '../save-blob';

const PART_COLORS: Record<SizePartKind, string> = {
  images: '#e0742c',
  picture: '#e0742c',
  video: '#6d4ae0',
  audio: '#2c9be0',
  subtitles: '#8bc34a',
  media: '#6d4ae0',
  fonts: '#d4a017',
  embedded: '#c2185b',
  thumbnail: '#ff9e80',
  text: '#43a047',
  metadata: '#00897b',
  appended: '#e53935',
  structure: '#9e9e9e',
  other: '#78909c',
};

/** Longest side of pictures in a document after shrinking (enough for a full page at print quality). */
const MAX_SIDE = 2000;

/** A smaller version of a picture in the same format, or null. */
async function shrinkPicture(name: string, bytes: Uint8Array): Promise<Uint8Array | null> {
  const jpeg = /\.jpe?g$/i.test(name);
  // Pictures turned by an EXIF tag would end up turned differently – keep them.
  if (jpeg && jpegOrientation(bytes) !== 1) return null;
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const f = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  // A PNG only gets smaller by getting smaller in pixels (same format, no quality loss).
  if (!jpeg && f === 1) {
    bitmap.close();
    return null;
  }
  const w = Math.max(1, Math.round(bitmap.width * f));
  const h = Math.max(1, Math.round(bitmap.height * f));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await canvas.convertToBlob(
    jpeg ? { type: 'image/jpeg', quality: 0.82 } : { type: 'image/png' },
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** Warum so groß? – what the bytes of a file are, and what would make it smaller. */
export function SizeCheckTool() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<{ file: File; r: SizeReport } | null>(null);
  const [failed, setFailed] = useState<File | null>(null);
  const [shrinking, setShrinking] = useState<number | null>(null);
  const [shrunk, setShrunk] = useState<{ file: File; saved: number; replaced: number } | null>(
    null,
  );
  const addFiles = useFiles((s) => s.addFiles);
  const defaultMode = useSettings((s) => s.defaultMode);
  const size = (n: number) => formatBytes(n, i18n.language);

  useEffect(() => {
    if (!file) return;
    let active = true;
    sizeReport(blobReader(file))
      .then((r) => active && setReport({ file, r }))
      .catch((e: unknown) => {
        console.error(e);
        if (active) setFailed(file);
      });
    return () => {
      active = false;
    };
  }, [file]);

  const r = report && report.file === file ? report.r : null;
  const base = file?.name.replace(/\.[^.]+$/, '') ?? 'file';
  const ext = file?.name.split('.').pop() ?? 'bin';

  async function shrink() {
    if (!file) return;
    setShrinking(0);
    try {
      const out = await shrinkZipImages(blobReader(file), shrinkPicture, setShrinking);
      if (out.replaced > 0)
        saveBlob(
          new Blob([out.bytes as Uint8Array<ArrayBuffer>], { type: file.type }),
          `${base}-klein.${ext}`,
        );
      setShrunk({ file, saved: out.saved, replaced: out.replaced });
    } catch (e) {
      console.error(e);
      setShrunk({ file, saved: 0, replaced: -1 });
    } finally {
      setShrinking(null);
    }
  }

  async function toCompress() {
    if (!file) return;
    await addFiles([file], defaultMode, 'compress');
    window.location.hash = '#/compress';
  }

  function action(tip: SizeTip) {
    if (!file || !r) return null;
    if (tip.action === 'shrinkImages')
      return (
        <Button size="sm" onClick={() => void shrink()} disabled={shrinking !== null}>
          {shrinking !== null ? (
            <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <MinimizeIcon aria-hidden="true" />
          )}
          {shrinking !== null
            ? t('workshop.sizecheck.shrinking', { percent: Math.round(shrinking * 100) })
            : t('workshop.sizecheck.actions.shrinkImages')}
        </Button>
      );
    if (tip.action === 'compress')
      return (
        <Button size="sm" variant="outline" onClick={() => void toCompress()}>
          <MinimizeIcon aria-hidden="true" />
          {t('workshop.sizecheck.actions.compress')}
        </Button>
      );
    if (tip.action === 'stripAppended' && r.appendedAt !== undefined) {
      const at = r.appendedAt;
      return (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => saveBlob(file.slice(0, at, file.type), `${base}-ohne-anhang.${ext}`)}
          >
            <ScissorsIcon aria-hidden="true" />
            {t('workshop.sizecheck.actions.stripAppended')}
          </Button>
          {tip.key === 'motionPhoto' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => saveBlob(file.slice(at, file.size, 'video/mp4'), `${base}-video.mp4`)}
            >
              <FilmIcon aria-hidden="true" />
              {t('workshop.sizecheck.actions.saveVideo')}
            </Button>
          )}
        </div>
      );
    }
    return null;
  }

  return (
    <div className="space-y-4">
      <HowItWorks trick="sizecheck" />
      <SingleFile file={file} onFile={setFile} />
      {file && failed === file && (
        <p role="alert" className="text-sm text-destructive">
          {t('workshop.sizecheck.failed')}
        </p>
      )}
      {file && !r && failed !== file && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {t('workshop.sizecheck.working')}
        </p>
      )}
      {r && (
        <div className="space-y-4" data-testid="sizecheck-report">
          <p className="text-sm">
            {t('workshop.sizecheck.summary', {
              kind: t(`workshop.sizecheck.kinds.${r.kind}`),
              size: size(r.total),
            })}
          </p>
          <div
            className="flex h-8 overflow-hidden rounded-md border"
            role="img"
            aria-label={t('workshop.sizecheck.bar')}
          >
            {r.parts.map((p) => (
              <div
                key={p.kind}
                title={t(`workshop.sizecheck.parts.${p.kind}`)}
                style={{ background: PART_COLORS[p.kind], width: `${(p.bytes / r.total) * 100}%` }}
              />
            ))}
          </div>
          <ul className="space-y-2">
            {r.parts.map((p) => {
              const share = (p.bytes / r.total) * 100;
              return (
                <li key={p.kind} className="rounded-lg border p-3 text-sm">
                  <details>
                    <summary className="flex cursor-pointer list-none items-center gap-2">
                      <span
                        className="size-3 shrink-0 rounded-sm"
                        style={{ background: PART_COLORS[p.kind] }}
                      />
                      <span className="flex-1 font-medium">
                        {t(`workshop.sizecheck.parts.${p.kind}`)}
                      </span>
                      <span className="tabular-nums">{size(p.bytes)}</span>
                      <span className="w-14 text-right tabular-nums text-muted-foreground">
                        {share < 1 ? '< 1' : Math.round(share)} %
                      </span>
                    </summary>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t(`workshop.sizecheck.partHelp.${p.kind}`)}
                    </p>
                    {p.items.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs">
                        {p.items.map((it, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="min-w-0 flex-1 truncate font-mono" title={it.name}>
                              {it.name}
                              {it.note && (
                                <span className="text-muted-foreground"> · {it.note}</span>
                              )}
                            </span>
                            <span className="tabular-nums">{size(it.bytes)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
          <div className="space-y-2">
            <h3 className="font-medium">{t('workshop.sizecheck.tipsTitle')}</h3>
            {r.tips.map((tip) => (
              <div
                key={tip.key}
                className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
              >
                <p>{t(`workshop.sizecheck.tips.${tip.key}`, tip.values ?? {})}</p>
                {action(tip)}
              </div>
            ))}
            {shrunk && shrunk.file === file && (
              <p role="status" className="text-sm">
                {shrunk.replaced > 0
                  ? t('workshop.sizecheck.shrunk', {
                      count: shrunk.replaced,
                      saved: size(shrunk.saved),
                    })
                  : shrunk.replaced === 0
                    ? t('workshop.sizecheck.notShrunk')
                    : t('workshop.sizecheck.shrinkFailed')}
              </p>
            )}
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <DownloadIcon className="size-3" aria-hidden="true" />
            {t('workshop.sizecheck.local')}
          </p>
        </div>
      )}
    </div>
  );
}
