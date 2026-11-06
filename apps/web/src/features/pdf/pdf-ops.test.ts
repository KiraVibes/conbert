// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  buildPdf,
  countPages,
  groupLabel,
  parseRanges,
  splitPdf,
  turn,
  type PageRef,
  type PdfSource,
} from './pdf-ops';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(import.meta.dirname, '../../engines/__fixtures__', name)));

/** A PDF whose pages say their number, with one page sized differently each. */
async function numberedPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([200 + i, 300]);
    page.drawText(`Page ${i}`, { x: 20, y: 150, size: 20, font });
  }
  return doc.save();
}

const ref = (sourceId: string, index: number, rotation: PageRef['rotation'] = 0): PageRef => ({
  id: `${sourceId}-${index}`,
  sourceId,
  index,
  rotation,
});

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

describe('PDF page tools', () => {
  it('merges pages of several PDFs and pictures in any order, turned', async () => {
    const a: PdfSource = { id: 'a', name: 'a.pdf', kind: 'pdf', bytes: await numberedPdf(3) };
    const b: PdfSource = { id: 'b', name: 'b.pdf', kind: 'pdf', bytes: await numberedPdf(2) };
    const photo: PdfSource = {
      id: 'p',
      name: 'photo.jpg',
      kind: 'jpg',
      bytes: fixture('sample.jpg'),
    };
    const logo: PdfSource = {
      id: 'l',
      name: 'logo.png',
      kind: 'png',
      bytes: fixture('sample.png'),
    };
    expect(await countPages(a)).toBe(3);
    expect(await countPages(photo)).toBe(1);

    const seen: number[] = [];
    const out = await buildPdf(
      [a, b, photo, logo],
      [ref('b', 1), ref('a', 2, 90), ref('p', 0), ref('a', 0), ref('l', 0, 270)],
      (done) => seen.push(done),
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(5);
    expect((await widths(out)).slice(0, 2)).toEqual([202, 203]);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0, 0, 270]);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('adds the turn to a page that was already turned', async () => {
    const doc = await PDFDocument.create();
    doc.addPage().setRotation({ type: 'degrees', angle: 90 } as never);
    const src: PdfSource = { id: 's', name: 's.pdf', kind: 'pdf', bytes: await doc.save() };
    const out = await PDFDocument.load(await buildPdf([src], [ref('s', 0, 270)]));
    expect(out.getPage(0).getRotation().angle).toBe(0);
  });

  it('splits into one file per range', async () => {
    const a: PdfSource = { id: 'a', name: 'a.pdf', kind: 'pdf', bytes: await numberedPdf(5) };
    const pages = [0, 1, 2, 3, 4].map((i) => ref('a', i));
    const groups = parseRanges('1-2, 4, 5-', 5);
    expect(groups).toEqual([[1, 2], [4], [5]]);
    const files = await splitPdf([a], pages, groups ?? [], (g) => `a-${groupLabel(g)}.pdf`);
    expect(files.map((f) => f.name)).toEqual(['a-1-2.pdf', 'a-4.pdf', 'a-5.pdf']);
    expect(await widths(files[0]?.bytes ?? new Uint8Array())).toEqual([201, 202]);
    expect(await widths(files[2]?.bytes ?? new Uint8Array())).toEqual([205]);
  });

  it('explains broken and protected files', async () => {
    const broken: PdfSource = {
      id: 'x',
      name: 'x.pdf',
      kind: 'pdf',
      bytes: new TextEncoder().encode('not a pdf at all'),
    };
    await expect(buildPdf([broken], [ref('x', 0)])).rejects.toMatchObject({
      messageKey: 'errors.pdfBroken',
    });
    await expect(buildPdf([], [])).rejects.toMatchObject({ messageKey: 'errors.pdfNoPages' });
    const fake: PdfSource = { id: 'f', name: 'f.png', kind: 'png', bytes: fixture('sample.jpg') };
    await expect(buildPdf([fake], [ref('f', 0)])).rejects.toMatchObject({
      messageKey: 'errors.pdfImageBroken',
    });
  });
});

describe('page ranges', () => {
  it.each([
    ['1-3, 5', 6, [[1, 2, 3], [5]]],
    ['2', 3, [[2]]],
    ['4-', 6, [[4, 5, 6]]],
    ['-2', 6, [[1, 2]]],
    ['1–2; 3', 3, [[1, 2], [3]]],
  ])('reads "%s"', (text, total, expected) => {
    expect(parseRanges(text, total)).toEqual(expected);
  });

  it.each([['0'], ['7'], ['3-1'], ['a'], [''], ['1-2-3']])('rejects "%s"', (text) => {
    expect(parseRanges(text, 6)).toBeNull();
  });

  it('labels groups and turns both ways', () => {
    expect(groupLabel([3])).toBe('3');
    expect(groupLabel([1, 2, 3])).toBe('1-3');
    expect(groupLabel([1, 4])).toBe('1+4');
    expect(turn(0, -90)).toBe(270);
    expect(turn(270, 90)).toBe(0);
  });
});
