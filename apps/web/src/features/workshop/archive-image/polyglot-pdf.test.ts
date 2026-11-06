// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { makePolyglot } from '@conbert/core';

const FIXTURES = path.resolve(import.meta.dirname, '../../../engines/__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

/** Opens the PDF the way Firefox does (pdf.js follows the cross-reference tables). */
async function pdfjsPages(bytes: Uint8Array): Promise<number> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), stopAtErrors: true });
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}

const zip = () => zipSync({ 'im-pdf.txt': strToU8('Hallo aus dem PDF') });

describe('PDF + ZIP polyglot', () => {
  it('keeps a classic PDF readable for pdf.js and pdf-lib', async () => {
    const pdf = fixture('sample.pdf');
    const out = await makePolyglot(pdf, zip());
    expect(await pdfjsPages(out)).toBe(await pdfjsPages(pdf));
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
    expect(strFromU8(unzipSync(out)['im-pdf.txt'] ?? new Uint8Array())).toBe('Hallo aus dem PDF');
  });

  it('works with a cross-reference stream (PDF 1.5+, as most programs save today)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    doc.addPage([200, 100]);
    doc.addPage([200, 100]);
    const pdf = await doc.save({ useObjectStreams: true });
    const tail = new TextDecoder('latin1').decode(pdf.subarray(-200));
    expect(tail).not.toContain('trailer');
    const out = await makePolyglot(pdf, zip());
    expect(await pdfjsPages(out)).toBe(3);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
    expect(Object.keys(unzipSync(out))).toEqual(['im-pdf.txt']);
  });
});
