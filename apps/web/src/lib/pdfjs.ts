import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

/** pdf.js resources, served by Conbert itself (copied by scripts/copy-wasm.mjs). */
const PDFJS = '/wasm/pdfjs/';

/** Opens a PDF with pdf.js (parsing runs in pdf.js' own worker). */
export async function openPdf(data: Blob | Uint8Array): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  return pdfjs.getDocument({
    data: data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data,
    cMapUrl: `${PDFJS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS}standard_fonts/`,
    wasmUrl: `${PDFJS}wasm/`,
    // No forms engine; PDF scripts never run (no scripting is set up).
    enableXfa: false,
  });
}
