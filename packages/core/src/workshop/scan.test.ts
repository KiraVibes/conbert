import { readFileSync } from 'node:fs';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  WorkshopError,
  bytesReader,
  detectiveScan,
  extractZipEntry,
  findZipEnd,
  normalizeZip,
  relocateZip,
  sliceReader,
  type ZipEntry,
} from './index';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../apps/web/src/engines/__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
function pngWithText(keyword: string, text: string): Uint8Array {
  const png = fixture('sample.png');
  const data = concat(strToU8(keyword, true), Uint8Array.of(0), strToU8(text, true));
  const chunk = concat(
    Uint8Array.from(be32(data.length)),
    strToU8('tEXt'),
    data,
    new Uint8Array(4),
  );
  // Behind the signature and IHDR (8 + 25 bytes).
  return concat(png.subarray(0, 33), chunk, png.subarray(33));
}

function entry(entries: ZipEntry[], i: number): ZipEntry {
  const e = entries[i];
  if (!e) throw new Error(`no entry ${i}`);
  return e;
}

/** Pseudo-random bytes (the same every run). */
function noise(length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = 0x12345678;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

const secret = zipSync({
  'geheim.txt': strToU8('Abrakadabra! '.repeat(50)),
  'ordner/klein.txt': [strToU8('eins'), { level: 0 }],
});

describe('detective scan', () => {
  it('finds an archive behind a picture and unpacks it', async () => {
    const png = fixture('sample.png');
    const file = concat(png, secret);
    const reader = bytesReader(file);
    const { findings } = await detectiveScan(reader, 'png');
    const hidden = findings.filter((f) => f.hidden);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]).toMatchObject({
      kind: 'appended',
      key: 'appendedKnown',
      format: 'zip',
      offset: png.length,
    });
    const entries = hidden[0]?.entries ?? [];
    expect(entries.map((e) => e.name)).toEqual(['geheim.txt', 'ordner/klein.txt']);
    const part = sliceReader(reader, png.length);
    expect(strFromU8(await extractZipEntry(part, entry(entries, 0)))).toBe(
      'Abrakadabra! '.repeat(50),
    );
    expect(strFromU8(await extractZipEntry(part, entry(entries, 1)))).toBe('eins');
    // Cut out, the archive opens in any ZIP program.
    expect(Object.keys(unzipSync(await normalizeZip(file.slice(png.length))))).toHaveLength(2);
  });

  it('reads an archive that was moved behind a picture like zip -A', async () => {
    const jpg = fixture('sample.jpg');
    const polyglot = concat(jpg, await relocateZip(secret, jpg.length));
    expect((await findZipEnd(bytesReader(polyglot)))?.shift).toBe(0);
    expect(strFromU8(unzipSync(polyglot)['ordner/klein.txt'] ?? new Uint8Array())).toBe('eins');
    const { findings } = await detectiveScan(bytesReader(polyglot), 'jpg');
    expect(findings.find((f) => f.hidden)).toMatchObject({ format: 'zip', offset: jpg.length });
    // Read as ZIP, the picture is what sits in front of it.
    const asZip = await detectiveScan(bytesReader(polyglot), 'zip');
    expect(asZip.findings.find((f) => f.hidden)).toMatchObject({
      kind: 'prefix',
      key: 'prefixKnown',
      format: 'jpg',
      length: jpg.length,
    });
  });

  it('finds a file in the middle of another one', async () => {
    const gif = fixture('sample-animated.gif');
    const file = concat(noise(5000), gif, noise(3000));
    const { findings } = await detectiveScan(bytesReader(file), null);
    expect(findings.filter((f) => f.hidden)).toEqual([
      expect.objectContaining({
        kind: 'embedded',
        format: 'gif',
        offset: 5000,
        length: gif.length,
      }),
    ]);
  });

  it('shows text notes and invisible characters', async () => {
    const png = pngWithText('Comment', 'Treffpunkt um Mitternacht');
    const notes = (await detectiveScan(bytesReader(png), 'png')).findings;
    expect(notes).toEqual([
      expect.objectContaining({
        kind: 'text-note',
        text: 'Treffpunkt um Mitternacht',
        values: { keyword: 'Comment' },
      }),
    ]);
    const text = strToU8(`Hallo${String.fromCharCode(0x200b, 0x200c, 0x200b)} Welt`);
    const zw = (await detectiveScan(bytesReader(text), null)).findings;
    expect(zw).toEqual([
      expect.objectContaining({ kind: 'zero-width', offset: 5, values: { count: 3 } }),
    ]);
  });

  it('stays quiet for normal files and random bytes', async () => {
    for (const [name, ext] of [
      ['sample.png', 'png'],
      ['sample.jpg', 'jpg'],
      ['sample-animated.gif', 'gif'],
      ['sample.webp', 'webp'],
      ['sample.wav', 'wav'],
      ['sample.pdf', 'pdf'],
      ['sample.zip', 'zip'],
      ['sample.docx', 'docx'],
      ['sample.xlsx', 'xlsx'],
      ['sample.mp4', 'mp4'],
    ] as const) {
      const { findings } = await detectiveScan(bytesReader(fixture(name)), ext);
      expect(
        findings.filter((f) => f.hidden),
        name,
      ).toEqual([]);
    }
    const { findings } = await detectiveScan(bytesReader(noise(3 * 1024 * 1024)), null);
    expect(findings).toEqual([]);
  });
});

describe('zip tools', () => {
  it('refuses encrypted entries and broken archives', async () => {
    const reader = bytesReader(secret);
    const end = await findZipEnd(reader);
    expect(end).not.toBeNull();
    await expect(
      extractZipEntry(reader, {
        name: 'x',
        offset: 0,
        compressedSize: 1,
        size: 1,
        encrypted: true,
        directory: false,
        method: 8,
        crc: 0,
      }),
    ).rejects.toBeInstanceOf(WorkshopError);
    await expect(relocateZip(strToU8('kein zip'), 10)).rejects.toMatchObject({ code: 'broken' });
  });
});
