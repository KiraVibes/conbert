import { useEffect, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { openPdf } from '@/lib/pdfjs';
import type { PdfSource } from './pdf-ops';
import { usePdfTool } from './pdf-store';

/**
 * Small pictures of the pages, rendered by pdf.js one after another (big
 * documents would otherwise block the browser). Pictures of image sources
 * are the images themselves.
 */

const THUMB_WIDTH = 160;
const docs = new Map<string, Promise<PDFDocumentProxy>>();
const tasks = new Map<string, Promise<PDFDocumentLoadingTask>>();
const thumbs = new Map<string, Promise<string>>();
const urls = new Map<string, string[]>();
let queue: Promise<unknown> = Promise.resolve();

function remember(sourceId: string, url: string): string {
  urls.set(sourceId, [...(urls.get(sourceId) ?? []), url]);
  return url;
}

function openDoc(source: PdfSource): Promise<PDFDocumentProxy> {
  let doc = docs.get(source.id);
  if (!doc) {
    // pdf.js takes the buffer over to its worker – give it a copy.
    const task = openPdf(source.bytes.slice());
    tasks.set(source.id, task);
    doc = task.then((t) => t.promise);
    docs.set(source.id, doc);
  }
  return doc;
}

async function render(source: PdfSource, index: number): Promise<string> {
  if (source.kind !== 'pdf') {
    const blob = new Blob([source.bytes.slice()], {
      type: `image/${source.kind === 'jpg' ? 'jpeg' : 'png'}`,
    });
    return remember(source.id, URL.createObjectURL(blob));
  }
  const doc = await openDoc(source);
  const page = await doc.getPage(index + 1);
  // The page's own rotation is part of the picture; the user's turns are CSS.
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (THUMB_WIDTH * 1.5) / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  // "print" draws in one go – "display" waits for animation frames, which a
  // hidden tab never gets, so thumbnails would hang in the background.
  await page.render({ canvas, viewport, intent: 'print' }).promise;
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.8),
  );
  page.cleanup();
  if (!blob) throw new Error('thumbnail failed');
  return remember(source.id, URL.createObjectURL(blob));
}

/**
 * Draws one page upright (with its own rotation) onto a canvas `width` pixels
 * wide. Also returns the page size in PDF points (1/72 inch).
 */
export async function renderPageCanvas(
  source: PdfSource,
  index: number,
  width: number,
): Promise<{ canvas: HTMLCanvasElement; points: { width: number; height: number } }> {
  const canvas = document.createElement('canvas');
  if (source.kind !== 'pdf') {
    const bitmap = await createImageBitmap(
      new Blob([source.bytes.slice()], { type: `image/${source.kind === 'jpg' ? 'jpeg' : 'png'}` }),
    );
    const scale = Math.min(1, width / bitmap.width);
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const points = { width: bitmap.width * 0.75, height: bitmap.height * 0.75 };
    bitmap.close();
    return { canvas, points };
  }
  const doc = await openDoc(source);
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport, intent: 'print' }).promise;
  page.cleanup();
  return { canvas, points: { width: base.width, height: base.height } };
}

function thumbnail(source: PdfSource, index: number): Promise<string> {
  const key = `${source.id}:${index}`;
  let result = thumbs.get(key);
  if (!result) {
    result = queue.then(() => render(source, index));
    queue = result.catch(() => undefined);
    thumbs.set(key, result);
  }
  return result;
}

/** The picture of one page, or null while it is drawn (or if drawing failed). */
export function usePageThumb(source: PdfSource | undefined, index: number): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!source) return;
    let alive = true;
    thumbnail(source, index)
      .then((u) => alive && setUrl(u))
      .catch((error: unknown) => console.warn('page thumbnail failed', error));
    return () => {
      alive = false;
    };
  }, [source, index]);
  return url;
}

// Files that left the list: free their pictures and pdf.js documents.
usePdfTool.subscribe((state, prev) => {
  if (state.sources === prev.sources) return;
  const ids = new Set(state.sources.map((s) => s.id));
  for (const source of prev.sources) {
    if (ids.has(source.id)) continue;
    for (const url of urls.get(source.id) ?? []) URL.revokeObjectURL(url);
    urls.delete(source.id);
    void tasks
      .get(source.id)
      ?.then((t) => t.destroy())
      .catch(() => undefined);
    tasks.delete(source.id);
    docs.delete(source.id);
    for (const key of [...thumbs.keys()]) if (key.startsWith(`${source.id}:`)) thumbs.delete(key);
  }
});
