import { strToU8, zipSync, zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractImages } from './extract-images';
import { decodePng } from './raster';
import { bytesReader } from './reader';

const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

function pdfWith(objects: { dict: string; data: Uint8Array }[], trailer = '') {
  const parts: Uint8Array[] = [strToU8('%PDF-1.7\n')];
  objects.forEach((o, i) => {
    parts.push(strToU8(`${i + 1} 0 obj\n<< ${o.dict} /Length ${o.data.length} >>\nstream\n`));
    parts.push(o.data);
    parts.push(strToU8('\nendstream\nendobj\n'));
  });
  parts.push(strToU8(`trailer\n<< /Size ${objects.length + 1} ${trailer} >>\n%%EOF\n`));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('extract images', () => {
  it('takes pictures out of office files, previews last', async () => {
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'docProps/thumbnail.jpeg': FAKE_JPEG,
      'word/document.xml': strToU8('<w:document/>'),
      'word/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'word/media/image2.jpeg': FAKE_JPEG,
      'ppt/media/image1.png': new Uint8Array([1]),
    });
    const result = await extractImages(bytesReader(docx));
    expect(result?.container).toBe('zip');
    expect(result?.images.map((i) => [i.name, i.ext, i.preview])).toEqual([
      ['image1.png', 'png', false],
      ['image2.jpeg', 'jpg', false],
      ['image1-2.png', 'png', false],
      ['thumbnail.jpeg', 'jpg', true],
    ]);
  });

  it('returns null for files that are neither ZIP nor PDF', async () => {
    expect(await extractImages(bytesReader(strToU8('just text')))).toBeNull();
  });

  it('gets JPEGs and raw pictures out of a PDF and skips masks', async () => {
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
    // Same picture with PNG "Up" predictor rows.
    const predicted = new Uint8Array([2, 255, 0, 0, 0, 255, 0, 2, 1, 0, 255, 9, 10, 9]);
    const pdf = pdfWith([
      { dict: '/Type /XObject /Subtype /Image /Filter /DCTDecode', data: FAKE_JPEG },
      {
        dict: '/Subtype /Image /Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /FlateDecode /SMask 3 0 R',
        data: zlibSync(rgb),
      },
      {
        dict: '/Subtype /Image /Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode',
        data: zlibSync(new Uint8Array([255, 255, 0, 0])),
      },
      {
        dict: '/Subtype /Image /Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace 7 0 R /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /Columns 2 >>',
        data: zlibSync(predicted),
      },
      {
        dict: '/Subtype /Image /Width 2 /Height 2 /BitsPerComponent 1 /Filter /CCITTFaxDecode',
        data: new Uint8Array([0]),
      },
      { dict: '/Type /Metadata', data: strToU8('<x/>') },
    ]);
    const result = await extractImages(bytesReader(pdf), 'bild');
    expect(result?.container).toBe('pdf');
    expect(result?.skipped).toBe(1);
    expect(result?.images.map((i) => i.name)).toEqual([
      'bild-001.jpg',
      'bild-002.png',
      'bild-003.png',
    ]);
    expect(result?.images[0]?.bytes).toEqual(FAKE_JPEG);
    const png = decodePng(result?.images[2]?.bytes ?? new Uint8Array());
    expect(png?.width).toBe(2);
    expect([...(png?.data.subarray(0, 6) ?? [])]).toEqual([255, 0, 0, 0, 255, 0]);
    expect([...(png?.data.subarray(9, 12) ?? [])]).toEqual([9, 9, 9]);
  });

  it('refuses encrypted PDFs with a clear code', async () => {
    const pdf = pdfWith([], '/Encrypt 5 0 R');
    await expect(extractImages(bytesReader(pdf))).rejects.toMatchObject({ code: 'locked-pdf' });
  });
});
