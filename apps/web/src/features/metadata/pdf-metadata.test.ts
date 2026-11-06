// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { writeMetadataEdits } from './metadata-engine';

async function samplePdf(): Promise<Blob> {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.setTitle('Alt');
  doc.setAuthor('Max Muster');
  doc.setSubject('Geheim');
  doc.setKeywords(['a', 'b']);
  return new Blob([(await doc.save()).slice()], { type: 'application/pdf' });
}

const open = async (blob: Blob) => PDFDocument.load(await blob.arrayBuffer());

describe('PDF metadata (pdf-lib)', () => {
  it('changes and removes single document properties', async () => {
    const out = await open(
      await writeMetadataEdits(await samplePdf(), 'pdf', {
        values: { title: 'Neu', author: '', copyright: 'Conbert', date: '2020-05-01T10:00' },
        removeGps: false,
        removeAll: false,
      }),
    );
    expect(out.getTitle()).toBe('Neu');
    expect(out.getAuthor()).toBeUndefined();
    expect(out.getSubject()).toBe('Geheim');
    expect(out.getCreationDate()?.getFullYear()).toBe(2020);
  });

  it('removes everything when asked', async () => {
    const out = await open(
      await writeMetadataEdits(await samplePdf(), 'pdf', {
        values: {},
        removeGps: false,
        removeAll: true,
      }),
    );
    expect([out.getTitle(), out.getAuthor(), out.getSubject(), out.getKeywords()]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(out.getPageCount()).toBe(1);
  });

  it('explains files that are no PDFs', async () => {
    await expect(
      writeMetadataEdits(new Blob(['nope']), 'pdf', {
        values: { title: 'x' },
        removeGps: false,
        removeAll: false,
      }),
    ).rejects.toMatchObject({ messageKey: 'errors.metadataWriteFailed' });
  });
});
