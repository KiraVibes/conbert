import { ConversionError } from '@conbert/core';

/**
 * PDF page tools in the browser (pdf-lib): put pages from PDFs and pictures
 * together in any order, turn them, leave some out, split into several files.
 * Nothing leaves the device.
 */

export type Rotation = 0 | 90 | 180 | 270;

export interface PdfSource {
  id: string;
  name: string;
  kind: 'pdf' | 'jpg' | 'png';
  bytes: Uint8Array;
}

/** One page in the work list: page `index` (0-based) of a source, turned by `rotation`. */
export interface PageRef {
  id: string;
  sourceId: string;
  index: number;
  rotation: Rotation;
}

export interface OutputFile {
  name: string;
  bytes: Uint8Array;
}

/** A picture becomes a page of its own size (96 dpi, like on screen). */
const PX_TO_PT = 72 / 96;

export function turn(rotation: Rotation, by: 90 | -90): Rotation {
  return ((((rotation + by) % 360) + 360) % 360) as Rotation;
}

async function loadPdfLib() {
  return import('pdf-lib');
}

/** Opens a PDF with pdf-lib; protected or broken files get a clear error. */
async function openSource(lib: Awaited<ReturnType<typeof loadPdfLib>>, source: PdfSource) {
  try {
    return await lib.PDFDocument.load(source.bytes, { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConversionError(
      /encrypt/i.test(message) ? 'errors.encrypted' : 'errors.pdfBroken',
      `${source.name}: ${message}`,
    );
  }
}

/** How many pages a PDF has (pictures count as one page). */
export async function countPages(source: PdfSource): Promise<number> {
  if (source.kind !== 'pdf') return 1;
  const lib = await loadPdfLib();
  return (await openSource(lib, source)).getPageCount();
}

/** Builds one PDF from the given pages, in this order. */
export async function buildPdf(
  sources: readonly PdfSource[],
  pages: readonly PageRef[],
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  if (pages.length === 0) throw new ConversionError('errors.pdfNoPages');
  const lib = await loadPdfLib();
  const out = await lib.PDFDocument.create();
  const opened = new Map<string, Awaited<ReturnType<typeof openSource>>>();
  for (const [n, ref] of pages.entries()) {
    const source = sources.find((s) => s.id === ref.sourceId);
    if (!source) throw new ConversionError('errors.pdfBroken', `missing source ${ref.sourceId}`);
    if (source.kind === 'pdf') {
      let doc = opened.get(source.id);
      if (!doc) {
        doc = await openSource(lib, source);
        opened.set(source.id, doc);
      }
      const [page] = await out.copyPages(doc, [ref.index]);
      if (!page)
        throw new ConversionError('errors.pdfBroken', `${source.name}: page ${ref.index + 1}`);
      // Turn on top of the page's own rotation.
      page.setRotation(lib.degrees((page.getRotation().angle + ref.rotation) % 360));
      out.addPage(page);
    } else {
      let image;
      try {
        image =
          source.kind === 'jpg'
            ? await out.embedJpg(source.bytes)
            : await out.embedPng(source.bytes);
      } catch (error) {
        throw new ConversionError(
          'errors.pdfImageBroken',
          `${source.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const width = image.width * PX_TO_PT;
      const height = image.height * PX_TO_PT;
      const page = out.addPage([width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height });
      if (ref.rotation) page.setRotation(lib.degrees(ref.rotation));
    }
    onProgress?.(n + 1, pages.length);
  }
  return out.save();
}

/**
 * Reads page ranges like "1-3, 5, 8-" (1-based, "8-" = to the end).
 * Returns one list of page numbers per range, or null when the text is wrong
 * or a page doesn't exist.
 */
export function parseRanges(text: string, total: number): number[][] | null {
  const parts = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const ranges: number[][] = [];
  for (const part of parts) {
    const match = /^(\d+)?\s*(?:(-|–)\s*(\d+)?)?$/.exec(part);
    if (!match || (!match[1] && !match[3])) return null;
    const from = match[1] ? Number(match[1]) : 1;
    const to = match[2] ? (match[3] ? Number(match[3]) : total) : from;
    if (from < 1 || to > total || from > to) return null;
    ranges.push(Array.from({ length: to - from + 1 }, (_, i) => from + i));
  }
  return ranges;
}

/** "Urlaub.pdf" → "Urlaub". */
export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'dokument';
}

/** Splits the pages into several PDFs: one per group of positions (1-based). */
export async function splitPdf(
  sources: readonly PdfSource[],
  pages: readonly PageRef[],
  groups: readonly (readonly number[])[],
  nameFor: (group: readonly number[]) => string,
  onProgress?: (done: number, total: number) => void,
): Promise<OutputFile[]> {
  const files: OutputFile[] = [];
  for (const [n, group] of groups.entries()) {
    const chosen = group.map((position) => pages[position - 1]).filter((p) => p !== undefined);
    files.push({ name: nameFor(group), bytes: await buildPdf(sources, chosen) });
    onProgress?.(n + 1, groups.length);
  }
  return files;
}

/** "3" or "1-4" for a group of consecutive positions, "1+2+5" otherwise. */
export function groupLabel(group: readonly number[]): string {
  const first = group[0];
  const last = group.at(-1);
  if (first === undefined || last === undefined) return '';
  if (first === last) return String(first);
  const consecutive = group.every((p, i) => p === first + i);
  return consecutive ? `${first}-${last}` : group.join('+');
}
