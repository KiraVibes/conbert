import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatBytes } from '@/lib/format-bytes';
import { formatName } from '@/features/convert/format-text';
import type { FileItem } from '@/features/convert/files-store';
import { ComparePreview } from './ComparePreview';
import { DocumentPreview, HtmlPreview, SvgPreview, TextPreview } from './DocumentViews';
import { ArchivePreview, FontPreview, TablePreview } from './FilePreviews';
import { ImagePreview } from './ImagePreview';
import { ModelPreview } from './ModelPreview';
import { AudioPreview, VideoPreview } from './MediaViews';
import { PdfPreview } from './PdfPreview';
import { PreviewLoading, PreviewProblem } from './PreviewStatus';
import { previewKind, type PreviewSource } from './preview-source';
import { useDisplayUrl } from './use-display-url';

export type PreviewSide = 'original' | 'result' | 'compare';

function ConvertedImage({ source }: { source: PreviewSource }) {
  const display = useDisplayUrl(source, 'image');
  if (display.status === 'loading') return <PreviewLoading state={display} />;
  if (display.status === 'error') return <PreviewProblem state={display} />;
  return <ImagePreview url={display.url} alt={source.name} />;
}

/** The right renderer for a file. */
export function PreviewBody({ source }: { source: PreviewSource }) {
  const { t } = useTranslation();
  switch (previewKind(source.ext)) {
    case 'image':
      return <ConvertedImage source={source} />;
    case 'svg':
      return <SvgPreview source={source} />;
    case 'audio':
      return <AudioPreview source={source} />;
    case 'video':
      return <VideoPreview source={source} />;
    case 'pdf':
      return <PdfPreview source={source} />;
    case 'html':
      return <HtmlPreview source={source} />;
    case 'text':
      return <TextPreview source={source} />;
    case 'document':
      return <DocumentPreview source={source} />;
    case 'model':
      return <ModelPreview source={source} />;
    case 'archive':
      return <ArchivePreview source={source} />;
    case 'font':
      return <FontPreview source={source} />;
    case 'table':
      return <TablePreview source={source} />;
    case 'none':
      return (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('preview.notAvailable', { format: formatName(t, source.ext) })}
        </p>
      );
  }
}

interface PreviewDialogProps {
  item: FileItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: PreviewSide;
}

/** Preview of the original, the result and – for pictures – both side by side. */
export function PreviewDialog({
  item,
  open,
  onOpenChange,
  initial = 'original',
}: PreviewDialogProps) {
  const { t, i18n } = useTranslation();
  const result = item.result;
  const original = useMemo<PreviewSource>(
    () => ({ key: `${item.id}:original`, blob: item.file, ext: item.ext, name: item.name }),
    [item.id, item.file, item.ext, item.name],
  );
  const after = useMemo<PreviewSource | null>(
    () =>
      result
        ? {
            key: `${item.id}:${result.url}`,
            blob: result.blob,
            ext: result.ext,
            name: result.fileName,
          }
        : null,
    [item.id, result],
  );
  const comparable =
    after !== null && previewKind(original.ext) === 'image' && previewKind(after.ext) === 'image';
  const [tab, setTab] = useState<PreviewSide>(initial);
  const active =
    tab === 'compare' && !comparable ? 'result' : tab === 'result' && !after ? 'original' : tab;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{item.name}</DialogTitle>
          <DialogDescription>{t('preview.intro')}</DialogDescription>
        </DialogHeader>
        <Tabs value={active} onValueChange={(v) => setTab(v as PreviewSide)}>
          {after && (
            <TabsList>
              <TabsTrigger value="original">
                {t('preview.original', {
                  format: formatName(t, original.ext),
                  size: formatBytes(original.blob.size, i18n.language),
                })}
              </TabsTrigger>
              <TabsTrigger value="result">
                {t('preview.result', {
                  format: formatName(t, after.ext),
                  size: formatBytes(after.blob.size, i18n.language),
                })}
              </TabsTrigger>
              {comparable && <TabsTrigger value="compare">{t('preview.compare')}</TabsTrigger>}
            </TabsList>
          )}
          {/* Only the visible tab renders, so media stop playing when switching. */}
          <TabsContent value="original">
            {active === 'original' && <PreviewBody source={original} />}
          </TabsContent>
          {after && (
            <TabsContent value="result">
              {active === 'result' && <PreviewBody source={after} />}
            </TabsContent>
          )}
          {after && comparable && (
            <TabsContent value="compare">
              {active === 'compare' && <ComparePreview before={original} after={after} />}
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
