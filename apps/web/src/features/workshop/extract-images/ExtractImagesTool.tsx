import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadIcon, FileImageIcon, Loader2Icon } from 'lucide-react';
import {
  WorkshopError,
  blobReader,
  extractImages,
  type ExtractImagesResult,
  type ExtractedImage,
} from '@conbert/core';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatBytes } from '@/lib/format-bytes';
import { createZip, saveBlob } from '@/lib/zip';
import { HowItWorks, SingleFile } from '../SingleFile';

/** Formats a browser can show as <img>. */
const SHOWABLE = new Set(['png', 'jpg', 'gif', 'bmp', 'webp', 'svg', 'avif', 'ico']);
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
};

const blobOf = (image: ExtractedImage) =>
  new Blob([image.bytes as Uint8Array<ArrayBuffer>], {
    type: MIME[image.ext] ?? 'application/octet-stream',
  });

function Thumb({
  image,
  checked,
  onCheck,
}: {
  image: ExtractedImage;
  checked: boolean;
  onCheck: (on: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  // SVGs may carry scripts: they are only shown as <img> (no scripts run there).
  const url = useMemo(
    () => (SHOWABLE.has(image.ext) ? URL.createObjectURL(blobOf(image)) : null),
    [image],
  );
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return (
    <li className="flex flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex aspect-square items-center justify-center bg-muted/40">
        {url ? (
          <img src={url} alt={image.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
            <FileImageIcon className="size-8" aria-hidden="true" />
            {image.ext.toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 p-2 text-xs">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          aria-label={t('workshop.extractimages.select', { name: image.name })}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium" title={image.source}>
            {image.name}
          </span>
          <span className="text-muted-foreground">
            {formatBytes(image.bytes.length, i18n.language)}
          </span>
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label={t('workshop.extractimages.saveOne', { name: image.name })}
          title={t('workshop.extractimages.saveOne', { name: image.name })}
          onClick={() => saveBlob(blobOf(image), image.name)}
        >
          <DownloadIcon aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

/** Get all pictures out of Word, PowerPoint, Excel, LibreOffice, EPUB, Apple and PDF files. */
export function ExtractImagesTool() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<{
    file: File;
    result: ExtractImagesResult | null;
    error: string | null;
  } | null>(null);
  const [unselected, setUnselected] = useState<Set<ExtractedImage>>(new Set());
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    void extractImages(blobReader(file), t('workshop.extractimages.pdfPrefix'))
      .then((result) => {
        if (cancelled) return;
        setUnselected(new Set(result?.images.filter((i) => i.preview) ?? []));
        setState({ file, result, error: result ? null : 'notDocument' });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('extract images failed', error);
        setState({
          file,
          result: null,
          error: error instanceof WorkshopError ? `errors.${error.code}` : 'failed',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [file, t]);

  const current = state?.file === file ? state : null;
  const images = current?.result?.images ?? [];
  const chosen = images.filter((i) => !unselected.has(i));
  const base = file?.name.replace(/\.[^.]+$/, '') ?? 'bilder';

  const saveChosen = async () => {
    const [single] = chosen;
    if (chosen.length === 1 && single) {
      saveBlob(blobOf(single), single.name);
      return;
    }
    setZipping(true);
    try {
      saveBlob(
        await createZip(chosen.map((i) => ({ name: i.name, blob: blobOf(i) }))),
        `${base}-${t('workshop.extractimages.zipSuffix')}.zip`,
      );
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="space-y-4">
      <HowItWorks trick="extractimages" />
      <SingleFile file={file} onFile={setFile} />
      {file && !current && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          {t('workshop.extractimages.searching')}
        </p>
      )}
      {current?.error && (
        <p role="alert" className="text-sm text-destructive">
          {current.error.startsWith('errors.')
            ? t(`workshop.${current.error}`)
            : t(`workshop.extractimages.${current.error}`)}
        </p>
      )}
      {current?.result && (
        <Card className="gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium" role="status">
              {images.length === 0
                ? t('workshop.extractimages.none')
                : t('workshop.extractimages.found', { count: images.length })}
            </p>
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setUnselected(chosen.length === images.length ? new Set(images) : new Set())
                  }
                >
                  {chosen.length === images.length
                    ? t('workshop.extractimages.selectNone')
                    : t('workshop.extractimages.selectAll')}
                </Button>
                <Button
                  size="sm"
                  disabled={chosen.length === 0 || zipping}
                  onClick={() => void saveChosen()}
                >
                  {zipping ? (
                    <Loader2Icon className="animate-spin" aria-hidden="true" />
                  ) : (
                    <DownloadIcon aria-hidden="true" />
                  )}
                  {chosen.length > 1
                    ? t('workshop.extractimages.saveZip', { count: chosen.length })
                    : t('workshop.extractimages.saveSelected')}
                </Button>
              </div>
            )}
          </div>
          {current.result.skipped > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('workshop.extractimages.skipped', { count: current.result.skipped })}
            </p>
          )}
          {images.some((i) => i.preview) && (
            <p className="text-xs text-muted-foreground">{t('workshop.extractimages.previews')}</p>
          )}
          {current.result.container === 'pdf' && images.length > 0 && (
            <p className="text-xs text-muted-foreground">{t('workshop.extractimages.pdfHint')}</p>
          )}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((image) => (
              <Thumb
                key={`${image.source}-${image.name}`}
                image={image}
                checked={!unselected.has(image)}
                onCheck={(on) =>
                  setUnselected((old) => {
                    const next = new Set(old);
                    if (on) next.delete(image);
                    else next.add(image);
                    return next;
                  })
                }
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
