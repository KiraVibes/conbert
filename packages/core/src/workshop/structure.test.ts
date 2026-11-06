import { readFileSync } from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  FIELD_KEYS,
  FIELD_VALUE_KEYS,
  STRUCTURE_KEYS,
  bytesReader,
  crc32,
  dosDate,
  parseStructure,
  type FileStructure,
  type RegionField,
} from './index';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../apps/web/src/engines/__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

async function structure(bytes: Uint8Array, ext: string): Promise<FileStructure> {
  const s = await parseStructure(bytesReader(bytes), ext);
  if (!s) throw new Error(`no structure for ${ext}`);
  return s;
}

const allFields = (s: FileStructure): RegionField[] => s.regions.flatMap((r) => r.fields ?? []);
const fieldOf = (s: FileStructure, key: string) => allFields(s).find((f) => f.key === key);

/** Every key has a text, every field lies inside its region. */
function expectWellFormed(s: FileStructure, size: number) {
  for (const r of s.regions) {
    expect(STRUCTURE_KEYS, r.key).toContain(r.key);
    expect(r.end, r.key).toBeLessThanOrEqual(size);
    for (const f of r.fields ?? []) {
      expect(FIELD_KEYS, f.key).toContain(f.key);
      if (f.valueKey) expect(FIELD_VALUE_KEYS, f.valueKey).toContain(f.valueKey);
      expect(f.start, `${r.key}/${f.key}`).toBeGreaterThanOrEqual(r.start);
      expect(f.end, `${r.key}/${f.key}`).toBeLessThanOrEqual(r.end);
    }
  }
}

describe('Matroska / WebM from a real file', () => {
  it('explains a WebM and an MKV made by ffmpeg', async () => {
    const server = path.resolve(FIXTURES, '../../../../server/src/__fixtures__');
    const mkv = new Uint8Array(readFileSync(path.join(server, 'sample.mkv')));
    const m = await structure(mkv, 'mkv');
    expectWellFormed(m, mkv.length);
    expect(fieldOf(m, 'docType')?.value).toBe('matroska');
    const webm = new Uint8Array(readFileSync(path.join(server, 'sample.webm')));
    const s = await structure(webm, 'webm');
    expectWellFormed(s, webm.length);
    expect(fieldOf(s, 'docType')?.value).toBe('webm');
    expect(s.regions.some((r) => r.key === 'mkv.elements.cluster')).toBe(true);
    expect(fieldOf(s, 'codec')?.value).toMatch(/^[VA]_/);
  });
});

describe('fields', () => {
  it('explains the PNG header and checks every chunk checksum', async () => {
    const png = fixture('sample.png');
    const s = await structure(png, 'png');
    expectWellFormed(s, png.length);
    expect(fieldOf(s, 'width')?.value).toBeGreaterThan(0);
    expect(fieldOf(s, 'colorType')?.valueKey).toMatch(/^pngColor\./);
    const crcs = allFields(s).filter((f) => f.key === 'crc');
    expect(crcs.length).toBeGreaterThan(2);
    expect(crcs.every((f) => f.ok === true)).toBe(true);
    // One flipped bit in the picture data: that chunk's checksum no longer fits.
    const broken = png.slice();
    const idat = s.regions.find((r) => r.key === 'png.chunkData' && r.label === 'IDAT');
    const at = idat?.start ?? 0;
    broken[at] = (broken[at] ?? 0) ^ 1;
    const again = await structure(broken, 'png');
    expect(allFields(again).filter((f) => f.ok === false)).toHaveLength(1);
  });

  it('checks ZIP entries and reads their dates', async () => {
    const zip = zipSync({
      'a.txt': strToU8('Hallo '.repeat(100)),
      'b.txt': [strToU8('x'), { level: 0 }],
    });
    const s = await structure(zip, 'zip');
    expectWellFormed(s, zip.length);
    expect(
      allFields(s)
        .filter((f) => f.key === 'crc')
        .map((f) => f.ok),
    ).toEqual([true, true]);
    expect(dosDate(0x5b5e, 0x7000)).toBe('2025-10-30 14:00:00');
    expect(crc32(strToU8('123456789'))).toBe(0xcbf43926);
  });

  it('gives the existing formats their fields', async () => {
    for (const [name, ext] of [
      ['sample.jpg', 'jpg'],
      ['sample-animated.gif', 'gif'],
      ['sample.wav', 'wav'],
      ['sample.webp', 'webp'],
      ['sample.docx', 'docx'],
    ] as const) {
      const bytes = fixture(name);
      expectWellFormed(await structure(bytes, ext), bytes.length);
    }
    expect(
      fieldOf(await structure(fixture('sample.wav'), 'wav'), 'sampleRate')?.value,
    ).toBeGreaterThan(0);
    expect(fieldOf(await structure(fixture('sample.jpg'), 'jpg'), 'precision')?.value).toBe(8);
  });
});

describe('more formats', () => {
  it('reads MP4, HEIC and AVIF boxes', async () => {
    for (const [name, ext] of [
      ['sample.mp4', 'mp4'],
      ['sample.heic', 'heic'],
      ['sample.avif', 'avif'],
    ] as const) {
      const bytes = fixture(name);
      const s = await structure(bytes, ext);
      expect(s.truncated, name).toBe(false);
      expectWellFormed(s, bytes.length);
      expect(s.regions[0]?.label, name).toBe('ftyp');
    }
    const mp4 = await structure(fixture('sample.mp4'), 'mp4');
    expect(mp4.regions.some((r) => r.key === 'bmff.media')).toBe(true);
    expect(mp4.regions.some((r) => r.label === 'trak')).toBe(true);
  });

  it('reads MP3 tags and the first sound frame', async () => {
    const bytes = fixture('sample.mp3');
    const s = await structure(bytes, 'mp3');
    expectWellFormed(s, bytes.length);
    expect(s.regions.some((r) => r.key === 'mp3.audio')).toBe(true);
    expect(fieldOf(s, 'sampleRate')?.value).toBeGreaterThan(0);
  });

  it('reads TIFF directories and GZIP headers', async () => {
    const tiff = fixture('sample.tiff');
    const t = await structure(tiff, 'tiff');
    expectWellFormed(t, tiff.length);
    expect(t.regions.some((r) => r.key === 'tiff.ifd')).toBe(true);
    expect(allFields(t).some((f) => String(f.value).startsWith('ImageWidth'))).toBe(true);
    const tgz = fixture('sample.tgz');
    const g = await structure(tgz, 'gz');
    expectWellFormed(g, tgz.length);
    expect(g.regions.at(-1)?.key).toBe('gz.trailer');
  });

  it('reads FLAC, OGG, TAR and ICO', async () => {
    // FLAC: signature + STREAMINFO (44.1 kHz, 2 channels, 16 bit) as the last block.
    const info = new Uint8Array(34);
    info.set([0x10, 0x00, 0x10, 0x00], 0);
    info.set([0x0a, 0xc4, 0x42, 0xf0], 10);
    const flac = concat(strToU8('fLaC'), [0x80, 0, 0, 34], info, [0xff, 0xf8, 1, 2]);
    const f = await structure(flac, 'flac');
    expectWellFormed(f, flac.length);
    expect([
      fieldOf(f, 'sampleRate')?.value,
      fieldOf(f, 'channels')?.value,
      fieldOf(f, 'bitsPerSample')?.value,
    ]).toEqual([44100, 2, 16]);

    const page = (seq: number, body: number[]) =>
      concat(
        strToU8('OggS'),
        [0, seq === 0 ? 2 : 0],
        new Uint8Array(8),
        [1, 0, 0, 0],
        [seq, 0, 0, 0],
        new Uint8Array(4),
        [1, body.length],
        body,
      );
    const ogg = concat(page(0, [1, 2, 3]), page(1, [4, 5]));
    const o = await structure(ogg, 'ogg');
    expectWellFormed(o, ogg.length);
    expect(o.regions.filter((r) => r.key === 'ogg.page')).toHaveLength(2);
    expect(o.appendedAt).toBeNull();

    const header = new Uint8Array(512);
    header.set(strToU8('hallo.txt'), 0);
    header.set(strToU8('00000000005 '), 124);
    header.set(strToU8('14700000000 '), 136);
    header[156] = 0x30;
    const body = new Uint8Array(512);
    body.set(strToU8('Hallo'));
    const tar = concat(header, body, new Uint8Array(1024));
    const t = await structure(tar, 'tar');
    expectWellFormed(t, tar.length);
    expect(t.regions.map((r) => r.key)).toEqual(['tar.header', 'tar.data', 'tar.end']);
    expect(fieldOf(t, 'size')?.value).toBe(5);

    const png = fixture('sample.png');
    const entry = new Uint8Array(16);
    entry.set([16, 16, 0, 0, 1, 0, 32, 0]);
    new DataView(entry.buffer).setUint32(8, png.length, true);
    new DataView(entry.buffer).setUint32(12, 22, true);
    const ico = concat([0, 0, 1, 0, 1, 0], entry, png);
    const i = await structure(ico, 'ico');
    expectWellFormed(i, ico.length);
    expect(i.regions.map((r) => r.key)).toEqual(['ico.header', 'ico.entry', 'ico.png']);
  });
});
