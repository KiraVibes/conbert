import { strFromU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { cleanOffice, readOfficeSecrets } from './office-secrets';
import { bytesReader } from './reader';
import { buildTimeline, parseTagDate } from './timeline';

const enc = (s: string) => new TextEncoder().encode(s);
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': enc('<Types/>'),
    '_rels/.rels': enc(
      '<Relationships><Relationship Id="r1" Target="docProps/thumbnail.jpeg"/><Relationship Id="r2" Target="word/document.xml"/></Relationships>',
    ),
    'docProps/core.xml': enc(
      '<cp:coreProperties><dc:creator>Max Muster</dc:creator><cp:lastModifiedBy>Erika Beispiel</cp:lastModifiedBy><cp:revision>42</cp:revision><dcterms:created>2024-01-02T10:00:00Z</dcterms:created></cp:coreProperties>',
    ),
    'docProps/app.xml': enc(
      '<Properties><Company>Geheim GmbH</Company><TotalTime>380</TotalTime><Template>C:\\Users\\max\\Vorlagen\\Brief.dotm</Template></Properties>',
    ),
    'docProps/thumbnail.jpeg': new Uint8Array([0xff, 0xd8]),
    'word/document.xml': enc(
      `<w:document ${W}><w:body><w:p w:rsidR="00A1B2C3"><w:r><w:t>Preis: </w:t></w:r><w:del w:id="1" w:author="Erika Beispiel" w:date="2024-01-03T09:00:00Z"><w:r><w:delText>5000</w:delText></w:r></w:del><w:ins w:id="2" w:author="Erika Beispiel"><w:r><w:t>9000</w:t></w:r></w:ins><w:commentRangeStart w:id="0"/><w:r><w:rPr><w:vanish/></w:rPr><w:t>nur intern</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p></w:body></w:document>`,
    ),
    'word/comments.xml': enc(
      `<w:comments ${W}><w:comment w:id="0" w:author="Chef" w:initials="C"><w:p><w:r><w:t>Zu billig!</w:t></w:r></w:p></w:comment></w:comments>`,
    ),
    'word/settings.xml': enc(
      `<w:settings ${W}><w:rsids><w:rsid w:val="00A1B2C3"/><w:rsid w:val="00D4E5F6"/></w:rsids></w:settings>`,
    ),
  });
}

describe('office secrets', () => {
  it('finds names, company, template path, changes, comments and hidden text', async () => {
    const r = await readOfficeSecrets(bytesReader(docx()));
    expect(r.kind).toBe('word');
    expect(r.people.sort()).toEqual(['Chef', 'Erika Beispiel', 'Max Muster']);
    expect(r.properties).toEqual(
      expect.arrayContaining([
        { key: 'company', value: 'Geheim GmbH' },
        { key: 'totalTime', value: '380' },
        { key: 'revision', value: '42' },
      ]),
    );
    expect(r.changes).toEqual([
      { type: 'del', author: 'Erika Beispiel', date: '2024-01-03T09:00:00Z', text: '5000' },
      { type: 'ins', author: 'Erika Beispiel', date: null, text: '9000' },
    ]);
    expect(r.comments).toEqual([{ author: 'Chef', text: 'Zu billig!' }]);
    expect(r.hiddenText).toEqual(['nur intern']);
    expect(r.thumbnail).toBe(true);
    expect(r.sessions).toBe(2);
  });

  it('makes a clean copy', async () => {
    const clean = await cleanOffice(bytesReader(docx()), {
      acceptChanges: true,
      removeComments: true,
      removeHidden: true,
    });
    const files = unzipSync(clean);
    expect(files['docProps/thumbnail.jpeg']).toBeUndefined();
    const all = Object.values(files)
      .map((f) => strFromU8(f))
      .join('\n');
    for (const secret of [
      'Max Muster',
      'Erika',
      'Geheim GmbH',
      '5000',
      'nur intern',
      'Zu billig',
      'Chef',
      '00A1B2C3',
      'C:\\Users',
    ])
      expect(all).not.toContain(secret);
    const doc = strFromU8(files['word/document.xml'] ?? new Uint8Array());
    expect(doc).toContain('<w:t>9000</w:t>');
    expect(doc).toContain('<w:t>Preis: </w:t>');
    const again = await readOfficeSecrets(bytesReader(clean));
    expect(again.changes).toEqual([]);
    expect(again.comments).toEqual([]);
  });

  it('keeps comments and changes when asked to', async () => {
    const clean = await cleanOffice(bytesReader(docx()), {
      acceptChanges: false,
      removeComments: false,
      removeHidden: false,
    });
    const r = await readOfficeSecrets(bytesReader(clean));
    expect(r.changes).toHaveLength(2);
    expect(r.comments).toEqual([{ author: 'Autor', text: 'Zu billig!' }]);
    expect(r.people).toEqual(['Autor']);
  });
});

describe('timeline', () => {
  it('reads ExifTool dates', () => {
    expect(parseTagDate('2021:06:01 12:30:00+02:00')).toEqual({
      ms: Date.parse('2021-06-01T12:30:00+02:00'),
      iso: '2021-06-01T12:30:00+02:00',
      zoned: true,
    });
    expect(parseTagDate('0000:00:00 00:00:00')).toBeNull();
    expect(parseTagDate('2021:06:01')?.zoned).toBe(false);
  });

  it('orders the dates and points out what does not fit', () => {
    const { events, warnings } = buildTimeline(
      {
        'ExifIFD:DateTimeOriginal': '2023:05:01 10:00:00',
        'IFD0:ModifyDate': '2023:04:01 10:00:00',
        'IFD0:Software': 'Adobe Photoshop 25.0',
        'XMP-xmpMM:HistoryWhen': ['2023:05:02 11:00:00+02:00', '2023:05:03 11:00:00+01:00'],
        'System:FileModifyDate': '2024:01:01 00:00:00',
      },
      Date.parse('2022-01-01T00:00:00Z'),
      Date.parse('2024-06-01T00:00:00Z'),
    );
    expect(events.map((e) => e.label)).toEqual(['file', 'modified', 'taken', 'history', 'history']);
    expect(warnings.map((w) => w.key)).toEqual([
      'modifiedBeforeCreated',
      'editedWith',
      'fileOlder',
      'zones',
    ]);
  });
});
