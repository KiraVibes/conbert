import { useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ErrorMessage';
import { PreviewLoading } from './PreviewStatus';
import type { PreviewSource } from './preview-source';
import { openPdf } from '@/lib/pdfjs';

export function PdfPreview({ source }: { source: PreviewSource }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    openPdf(source.blob)
      .then((loading) => {
        task = loading;
        if (cancelled) return loading.destroy();
        return loading.promise.then((doc) => !cancelled && setPdf(doc));
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [source]);

  useEffect(() => {
    const target = canvas.current;
    if (!pdf || !target) return;
    let task: { cancel(): void } | null = null;
    void pdf.getPage(page).then((p) => {
      const width = target.parentElement?.clientWidth ?? 800;
      const base = p.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: (width / base.width) * ratio });
      target.width = viewport.width;
      target.height = viewport.height;
      target.style.width = `${viewport.width / ratio}px`;
      const render = p.render({ canvas: target, viewport });
      task = render;
      render.promise.catch(() => undefined);
    });
    return () => task?.cancel();
  }, [pdf, page]);

  if (error) return <ErrorMessage messageKey="errors.previewUnavailable" details={error} />;
  if (!pdf) return <PreviewLoading state={{ status: 'loading', progress: 0, converting: false }} />;
  return (
    <div className="space-y-2" data-testid="pdf-preview">
      <div className="h-[60vh] overflow-auto rounded-md border bg-muted">
        <canvas ref={canvas} className="mx-auto block" />
      </div>
      <div className="flex items-center justify-center gap-2">
        <Button
          size="icon-sm"
          variant="outline"
          onClick={() => setPage((n) => Math.max(1, n - 1))}
          disabled={page <= 1}
          aria-label={t('preview.previousPage')}
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t('preview.page', { page, pages: pdf.numPages })}
        </span>
        <Button
          size="icon-sm"
          variant="outline"
          onClick={() => setPage((n) => Math.min(pdf.numPages, n + 1))}
          disabled={page >= pdf.numPages}
          aria-label={t('preview.nextPage')}
        >
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
