// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

// pdf-finish draws pages with pdf.js in the browser; here only the watermark is tested.
vi.mock('./page-thumbs', () => ({ renderPageCanvas: vi.fn() }));
const { addWatermark, toPageSpace } = await import('./pdf-finish');
const { buildPdf } = await import('./pdf-ops');

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(import.meta.dirname, '../../engines/__fixtures__', name)));

async function twoPages(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 400]).drawText('Secret 1', { x: 20, y: 200, size: 20, font });
  const turned = doc.addPage([300, 400]);
  turned.drawText('Secret 2', { x: 20, y: 200, size: 20, font });
  turned.setRotation(degrees(90));
  return doc.save();
}

describe('watermark', () => {
  it('maps points of the visible page onto turned pages', () => {
    // Bottom-left of a page turned 90° clockwise is its unturned bottom-right … top-left.
    expect(toPageSpace(0, 0, 0, 90, 300, 400)).toEqual({ x: 300, y: 0, angle: 90 });
    expect(toPageSpace(10, 20, 45, 0, 300, 400)).toEqual({ x: 10, y: 20, angle: 45 });
    expect(toPageSpace(0, 0, 0, 180, 300, 400)).toEqual({ x: 300, y: 400, angle: 180 });
    expect(toPageSpace(0, 0, 0, 270, 300, 400)).toEqual({ x: 0, y: 400, angle: 270 });
  });

  it('stamps every page and keeps the page count', async () => {
    for (const position of ['diagonal', 'center', 'footer'] as const) {
      const out = await addWatermark(await twoPages(), { text: 'KOPIE – äöü', position });
      expect(out.dropped).toBe(false);
      const doc = await PDFDocument.load(out.bytes);
      expect(doc.getPageCount()).toBe(2);
      expect(out.bytes.length).toBeGreaterThan((await twoPages()).length);
    }
  });

  it('leaves out characters the PDF font cannot draw and says so', async () => {
    const out = await addWatermark(await twoPages(), { text: 'Hallo 😀', position: 'center' });
    expect(out.dropped).toBe(true);
    const only = await addWatermark(await twoPages(), { text: '😀', position: 'center' });
    expect(only.dropped).toBe(true);
  });
});

describe('black out', () => {
  it('rebuilds blacked-out pages as pictures and keeps the others', async () => {
    const source = { id: 's', name: 'a.pdf', kind: 'pdf' as const, bytes: await twoPages() };
    const png = fixture('sample.png');
    const flatten = vi.fn(() =>
      Promise.resolve({ bytes: png, kind: 'png' as const, width: 300, height: 400 }),
    );
    const bytes = await buildPdf(
      [source],
      [
        {
          id: '1',
          sourceId: 's',
          index: 0,
          rotation: 0,
          redactions: [{ x: 0, y: 0, w: 1, h: 0.5 }],
        },
        { id: '2', sourceId: 's', index: 1, rotation: 0 },
      ],
      undefined,
      flatten,
    );
    expect(flatten).toHaveBeenCalledTimes(1);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    // The rebuilt page holds no text any more – only the picture.
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('/Subtype /Image');
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });
});
