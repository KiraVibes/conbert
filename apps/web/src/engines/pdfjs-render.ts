import { ConversionError, PDF_RENDER_OPTIONS, resolvePdfRender } from '@conbert/core';
import { openPdf } from '@/lib/pdfjs';
import { createMainThreadEngine } from './main-thread-engine';

/** One PDF page as PNG or JPG, rendered by pdf.js (parsing in its own worker). */
export const pdfjsRenderEngine = createMainThreadEngine({
  meta: {
    id: 'pdfjs-render',
    name: 'pdf.js (Browser)',
    descriptionKey: 'engines.pdfjsRender.description',
    category: 'pdf',
    runtime: 'browser',
    formats: [
      { ext: 'pdf', canRead: true, canWrite: false },
      { ext: 'png', canRead: false, canWrite: true },
      { ext: 'jpg', canRead: false, canWrite: true },
    ],
    options: PDF_RENDER_OPTIONS,
    supportsCompression: false,
    priority: 10,
  },
  load: () => import('pdfjs-dist').then(() => undefined),
  async run(input, _inputExt, outputExt, options, onProgress) {
    const { page, dpi } = resolvePdfRender(options);
    const task = await openPdf(input);
    try {
      const pdf = await task.promise.catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw new ConversionError(
          /password/i.test(message) ? 'errors.encrypted' : 'errors.convertFailed',
          message,
        );
      });
      if (page > pdf.numPages) {
        throw new ConversionError(
          'errors.convertFailed',
          `page ${page} does not exist (${pdf.numPages} pages)`,
        );
      }
      onProgress(30, 'converting');
      const pdfPage = await pdf.getPage(page);
      // PDF units are 1/72 inch.
      const viewport = pdfPage.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new ConversionError('errors.convertFailed', 'no canvas');
      if (outputExt === 'jpg') {
        // JPG has no transparency: white paper.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      await pdfPage.render({ canvas, viewport }).promise;
      onProgress(90, 'converting');
      const type = outputExt === 'jpg' ? 'image/jpeg' : 'image/png';
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
      if (!blob) throw new ConversionError('errors.convertFailed', 'canvas export failed');
      return blob;
    } finally {
      await task.destroy();
    }
  },
});
