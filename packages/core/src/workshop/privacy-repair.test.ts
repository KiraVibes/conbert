import { readFileSync } from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  bytesReader,
  parseStructure,
  privacyFromOffice,
  privacyFromTags,
  repairFile,
  type RegionField,
} from './index';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../apps/web/src/engines/__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

describe('privacy check', () => {
  it('sorts what a photo gives away by how much it tells', () => {
    const findings = privacyFromTags({
      SourceFile: 'x.jpg',
      'System:FileName': 'x.jpg',
      'IFD0:Make': 'Canon',
      'IFD0:Model': 'EOS R6',
      'ExifIFD:BodySerialNumber': '0123456789',
      'IFD0:Software': 'GIMP 2.10',
      'Composite:GPSPosition': '47.3769 N, 8.5417 E',
      'XMP-mwg-rs:RegionName': ['Anna', 'Ben'],
      'IFD1:ThumbnailImage': '(Binary data 5000 bytes, use -b option to extract)',
      'ExifIFD:DateTimeOriginal': '2026:10:30 10:00:00',
      'IFD0:Artist': '',
    });
    expect(findings.map((f) => [f.kind, f.level])).toEqual([
      ['location', 'high'],
      ['serial', 'high'],
      ['personTags', 'high'],
      ['device', 'low'],
      ['software', 'low'],
      ['dates', 'low'],
      ['thumbnail', 'medium'],
    ]);
    expect(findings[0]?.values).toEqual(['47.3769 N, 8.5417 E']);
    expect(findings.find((f) => f.kind === 'personTags')?.values).toEqual(['Anna, Ben']);
    // An empty author says nothing.
    expect(findings.some((f) => f.kind === 'people')).toBe(false);
  });

  it('finds authors, comments, changes and hidden things in Office files', () => {
    const docx = zipSync({
      'docProps/core.xml': strToU8(
        '<cp:coreProperties><dc:creator>Anna Muster</dc:creator><cp:lastModifiedBy>Ben &amp; Co</cp:lastModifiedBy></cp:coreProperties>',
      ),
      'docProps/app.xml': strToU8('<Properties><Company>Geheim GmbH</Company></Properties>'),
      'word/comments.xml': strToU8(
        '<w:comments><w:comment w:id="0" w:author="Chef"/><w:comment w:id="1" w:author="Chef"/></w:comments>',
      ),
      'word/document.xml': strToU8(
        '<w:document><w:ins w:author="Ben"/><w:del w:author="Anna"/><w:r><w:rPr><w:vanish/></w:rPr></w:r></w:document>',
      ),
      'word/media/bild.png': fixture('sample.png'),
    });
    const f = privacyFromOffice(docx);
    const by = (kind: string) => f.find((x) => x.kind === kind);
    expect(by('officeAuthors')?.values).toEqual(['Anna Muster', 'Ben & Co']);
    expect(by('officeCompany')?.values).toEqual(['Geheim GmbH']);
    expect(by('officeComments')).toMatchObject({ count: 2, values: ['Chef'] });
    expect(by('officeChanges')).toMatchObject({ count: 2, values: ['Ben', 'Anna'] });
    expect(by('officeHidden')).toMatchObject({ count: 1 });

    const xlsx = zipSync({
      'xl/workbook.xml': strToU8(
        '<workbook><sheets><sheet name="Daten" sheetId="1"/><sheet name="Gehälter" sheetId="2" state="hidden"/></sheets></workbook>',
      ),
    });
    expect(privacyFromOffice(xlsx)).toEqual([
      expect.objectContaining({ kind: 'officeHidden', values: ['Gehälter'], count: 1 }),
    ]);
    expect(privacyFromOffice(strToU8('kein zip'))).toEqual([]);
  });
});

const crcFields = async (bytes: Uint8Array) =>
  ((await parseStructure(bytesReader(bytes), 'png'))?.regions ?? [])
    .flatMap((r) => r.fields ?? [])
    .filter((f: RegionField) => f.key === 'crc');

describe('repair', () => {
  const keep = { cutAppended: true };

  it('leaves healthy files alone', async () => {
    expect(await repairFile(fixture('sample.png'), 'bild.png', 'png', keep)).toMatchObject({
      fixes: [],
      bytes: null,
    });
  });

  it('recalculates wrong PNG checksums', async () => {
    const png = fixture('sample.png');
    const broken = png.slice();
    broken[30] = (broken[30] ?? 0) ^ 0xff; // inside the first chunk's checksum
    const r = await repairFile(broken, 'bild.png', 'png', keep);
    expect(r.fixes).toEqual([{ kind: 'pngCrc', count: 1 }]);
    expect((await crcFields(r.bytes ?? new Uint8Array())).every((f) => f.ok === true)).toBe(true);
  });

  it('closes cut-off pictures', async () => {
    const png = fixture('sample.png');
    const cut = png.slice(0, png.length - 20);
    const r = await repairFile(cut, 'bild.png', 'png', keep);
    // The cut-off picture data is kept (shortened), so there is still a picture.
    expect(r.fixes.map((f) => f.kind)).toEqual(['pngShortened', 'pngEnd']);
    const s = await parseStructure(bytesReader(r.bytes ?? new Uint8Array()), 'png');
    expect(s?.regions.some((x) => x.label === 'IEND')).toBe(true);
    expect(s?.regions.some((x) => x.label === 'IDAT' && x.kind === 'data')).toBe(true);
    expect(s?.truncated).toBe(false);
    expect((await crcFields(r.bytes ?? new Uint8Array())).every((f) => f.ok === true)).toBe(true);
    // Cut between chunks: nothing to keep, only the end is added.
    const iend = png.length - 12;
    const between = await repairFile(png.slice(0, iend), 'bild.png', 'png', keep);
    expect(between.fixes.map((f) => f.kind)).toEqual(['pngEnd']);
    expect(between.bytes).toEqual(png);

    const jpg = fixture('sample.jpg');
    const j = await repairFile(jpg.slice(0, jpg.length - 2), 'foto.jpg', 'jpg', keep);
    expect(j.fixes.map((f) => f.kind)).toEqual(['jpgEnd']);
    expect([...(j.bytes ?? []).slice(-2)]).toEqual([0xff, 0xd9]);
  });

  it('cuts data behind the end (if wanted) and fixes the extension', async () => {
    const png = fixture('sample.png');
    const withZip = new Uint8Array([...png, ...fixture('sample.zip')]);
    const r = await repairFile(withZip, 'urlaub.jpg', 'png', keep);
    expect(r.fixes).toEqual([
      { kind: 'appended', count: withZip.length - png.length },
      { kind: 'extension', name: 'urlaub.png' },
    ]);
    expect(r.bytes?.length).toBe(png.length);
    // Keep the appended archive: only the name changes, the bytes stay.
    const k = await repairFile(withZip, 'urlaub.jpg', 'png', { cutAppended: false });
    expect(k.fixes.map((f) => f.kind)).toEqual(['extension']);
    expect(k.bytes).toBe(withZip);
  });
});

describe('gps', () => {
  it('reads positions as ExifTool writes them', async () => {
    const { parseGps } = await import('./index');
    const p = parseGps(`47 deg 22' 36.84" N, 8 deg 32' 30.12" W`);
    expect(p?.lat).toBeCloseTo(47.3769, 3);
    expect(p?.lon).toBeCloseTo(-8.5417, 3);
    expect(parseGps('47.3769 N, 8.5417 E')).toEqual({ lat: 47.3769, lon: 8.5417 });
    expect(parseGps('irgendwo')).toBeNull();
  });
});
