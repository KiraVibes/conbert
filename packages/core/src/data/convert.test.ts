import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertData, detectDelimiter, previewTable } from './convert';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.resolve(import.meta.dirname, '../../../../apps/server/src/__fixtures__', name)));
const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe('detectDelimiter', () => {
  it('recognises semicolon, comma and tab tables', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
  });
});

describe('convertData', () => {
  it('turns a German CSV into JSON with numbers but keeps text', async () => {
    const json = JSON.parse(text(await convertData(fixture('sample.csv'), 'csv', 'json'))) as unknown[];
    expect(json[0]).toEqual({ Name: 'Anna', Stadt: 'Berlin', Punkte: 42 });
    expect(json[1]).toMatchObject({ Name: 'Jörg', Stadt: 'München' });
  });

  it('writes CSV for Excel: BOM, semicolon by default, comma on request', async () => {
    const bytes = await convertData(fixture('sample.json'), 'json', 'csv');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text(bytes).startsWith('name;stadt;punkte')).toBe(true);
    const comma = text(await convertData(fixture('sample.json'), 'json', 'csv', { csvDelimiter: 'comma' }));
    expect(comma).toContain('Jörg,München,17');
  });

  it('round-trips a table through Excel', async () => {
    const xlsx = await convertData(fixture('sample.json'), 'json', 'xlsx');
    expect(text(xlsx.subarray(0, 2))).toBe('PK');
    const back = JSON.parse(text(await convertData(xlsx, 'xlsx', 'json'))) as unknown[];
    expect(back).toEqual([
      { name: 'Anna', stadt: 'Berlin', punkte: 42 },
      { name: 'Jörg', stadt: 'München', punkte: 17 },
      { name: 'Zoë', stadt: 'Köln', punkte: 8 },
    ]);
  });

  it('reads an Excel file made by LibreOffice', async () => {
    const preview = await previewTable(fixture('sample.xlsx'), 'xlsx');
    expect(preview.columns).toEqual(['Name', 'Stadt', 'Punkte']);
    expect(preview.total).toBe(3);
  });

  it('converts settings between YAML, TOML, JSON and XML', async () => {
    const toml = text(await convertData(fixture('sample.yaml'), 'yaml', 'toml'));
    expect(toml).toContain('port = 3313');
    const json = JSON.parse(text(await convertData(new TextEncoder().encode(toml), 'toml', 'json'))) as {
      server: { hosts: string[] };
    };
    expect(json.server.hosts).toEqual(['nas.local', '192.168.1.10']);
    const xml = text(await convertData(fixture('sample.yaml'), 'yaml', 'xml'));
    expect(xml).toContain('<port>3313</port>');
  });

  it('reads XML lists as tables', async () => {
    const csv = text(await convertData(fixture('sample.xml'), 'xml', 'csv'));
    expect(csv).toContain('Jörg');
    expect(csv.split('\r\n')[0]).toContain('@id');
  });

  it('explains when data is not a table', async () => {
    await expect(convertData(fixture('sample.yaml'), 'yaml', 'csv')).rejects.toMatchObject({
      messageKey: 'errors.dataNotTable',
    });
  });

  it('reports broken files clearly', async () => {
    await expect(convertData(new TextEncoder().encode('{"a": '), 'json', 'yaml')).rejects.toMatchObject({
      messageKey: 'errors.dataInvalid',
    });
  });
});
