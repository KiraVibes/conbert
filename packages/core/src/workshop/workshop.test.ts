import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bytesReader,
  compareHash,
  entropyLevel,
  entropyProfile,
  findSignature,
  identifyFile,
  parseHashInput,
  parseStructure,
  regionAt,
  shannonEntropy,
  sniffText,
  type FileStructure,
} from './index';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../apps/web/src/engines/__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));

const enc = (s: string) => new TextEncoder().encode(s);
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
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

/** A ZIP with stored (uncompressed) entries – checksums don't matter here. */
function makeZip(entries: { name: string; data: string }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc(e.name);
    const data = enc(e.data);
    const local = concat(
      [0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      le32(0),
      le32(data.length),
      le32(data.length),
      le16(name.length),
      le16(0),
      name,
      data,
    );
    centrals.push(
      concat(
        [0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        le32(0),
        le32(data.length),
        le32(data.length),
        le16(name.length),
        le16(0),
        le16(0),
        le16(0),
        le16(0),
        le32(0),
        le32(offset),
        name,
      ),
    );
    locals.push(local);
    offset += local.length;
  }
  const cd = concat(...centrals);
  const eocd = concat(
    [0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0],
    le16(entries.length),
    le16(entries.length),
    le32(cd.length),
    le32(offset),
    le16(0),
  );
  return concat(...locals, cd, eocd);
}

function pngChunk(type: string, data: number[]): Uint8Array {
  return concat(be32(data.length), enc(type), data, [0, 0, 0, 0]);
}
const tinyPng = concat(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  pngChunk('IHDR', [...be32(3), ...be32(2), 8, 6, 0, 0, 0]),
  pngChunk('IDAT', [1, 2, 3]),
  pngChunk('IEND', []),
);

async function structure(bytes: Uint8Array, ext: string): Promise<FileStructure> {
  const s = await parseStructure(bytesReader(bytes), ext);
  if (!s) throw new Error(`no structure for ${ext}`);
  return s;
}

/** Regions cover the file without gaps or overlaps. */
function expectContiguous(s: FileStructure, size: number) {
  let at = 0;
  for (const r of s.regions) {
    expect(r.start, `${r.key} at ${r.start}`).toBe(at);
    at = r.end;
  }
  expect(at).toBe(size);
}

describe('identify', () => {
  it('finds the bytes that give a type away', () => {
    expect(findSignature(tinyPng)).toEqual({ ext: 'png', offset: 0, length: 8 });
    expect(findSignature(fixture('sample.webp'))).toMatchObject({ ext: 'webp', length: 12 });
    expect(findSignature(enc('hello'))).toBeNull();
  });

  it('says when the name lies', () => {
    const head = makeZip([{ name: 'a.txt', data: 'a' }]);
    const id = identifyFile({ name: 'Bericht.pdf', detectedExt: 'zip', head });
    expect(id).toMatchObject({ verdict: 'mismatch', realExt: 'zip', suggestedName: 'Bericht.zip' });
    expect(identifyFile({ name: 'foto.JPEG', detectedExt: 'jpg', head: tinyPng }).verdict).toBe(
      'match',
    );
    expect(identifyFile({ name: 'download', detectedExt: 'png', head: tinyPng })).toMatchObject({
      verdict: 'missing-ext',
      suggestedName: 'download.png',
    });
  });

  it('keeps container formats whose name says more than the content', () => {
    const id = identifyFile({
      name: 'Brief.docx',
      detectedExt: 'zip',
      head: fixture('sample.docx'),
    });
    expect(id.verdict).toBe('match');
    expect(id.signature?.ext).toBe('zip');
  });

  it('recognises text and a "picture" that is really text', () => {
    expect(
      identifyFile({ name: 'notiz.md', detectedExt: null, head: enc('# Hallo Welt') }).verdict,
    ).toBe('text');
    expect(
      identifyFile({ name: 'bild.png', detectedExt: null, head: enc('<html>404</html>') }),
    ).toMatchObject({
      verdict: 'text-mismatch',
      suggestedName: 'bild.txt',
    });
    expect(
      identifyFile({ name: 'x.bin', detectedExt: null, head: Uint8Array.from([0, 1, 2, 250]) })
        .verdict,
    ).toBe('unknown');
  });

  it('tells text encodings apart', () => {
    expect(sniffText(enc('plain'))).toBe('ascii');
    expect(sniffText(enc('Grüße'))).toBe('utf-8');
    expect(sniffText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]))).toBe('utf-8-bom');
    expect(sniffText(Uint8Array.from([0xff, 0xfe, 0x41, 0]))).toBe('utf-16le');
    expect(sniffText(Uint8Array.from([0x47, 0x72, 0xfc, 0xdf, 0x65]))).toBe('latin1');
    expect(sniffText(Uint8Array.from([0x41, 0, 0x42]))).toBeNull();
    // A sample cut in the middle of a character is still UTF-8.
    expect(sniffText(enc('Grü').subarray(0, 3))).toBe('utf-8');
  });
});

describe('structure', () => {
  it('reads PNG chunks and finds an archive hidden behind the end', async () => {
    const zip = makeZip([{ name: 'geheim.txt', data: 'Abrakadabra' }]);
    const bytes = concat(tinyPng, zip);
    const s = await structure(bytes, 'png');
    expectContiguous(s, bytes.length);
    expect(s.regions.find((r) => r.label === 'IHDR' && r.kind === 'chunk')?.values).toMatchObject({
      width: 3,
      height: 2,
    });
    expect(s.appendedAt).toBe(tinyPng.length);
    expect(s.regions.at(-1)).toMatchObject({
      kind: 'appended',
      key: 'appendedKnown',
      values: { format: 'zip', bytes: zip.length },
    });
  });

  it('reads the ZIP inside a picture (the archive-in-image trick)', async () => {
    const zip = makeZip([
      { name: 'a.txt', data: 'eins' },
      { name: 'ordner/b.txt', data: 'zwei' },
    ]);
    const bytes = concat(tinyPng, zip);
    const s = await structure(bytes, 'zip');
    expectContiguous(s, bytes.length);
    expect(s.regions[0]).toMatchObject({
      kind: 'data',
      key: 'zip.prefixKnown',
      values: { format: 'png' },
    });
    expect(s.entries?.map((e) => [e.name, e.offset])).toEqual([
      ['a.txt', tinyPng.length],
      ['ordner/b.txt', tinyPng.length + 30 + 5 + 4],
    ]);
  });

  it('explains real files from the fixtures without gaps', async () => {
    for (const [name, ext] of [
      ['sample.png', 'png'],
      ['sample.jpg', 'jpg'],
      ['sample-animated.gif', 'gif'],
      ['sample.webp', 'webp'],
      ['sample.wav', 'wav'],
      ['sample.pdf', 'pdf'],
      ['sample.zip', 'zip'],
      ['sample.docx', 'docx'],
    ] as const) {
      const bytes = fixture(name);
      const s = await structure(bytes, ext);
      expect(s.truncated, name).toBe(false);
      expect(s.appendedAt, name).toBeNull();
      expectContiguous(s, bytes.length);
    }
  });

  it('labels JPEG markers and the picture size', async () => {
    const s = await structure(fixture('sample.jpg'), 'jpg');
    expect(s.regions[0]?.key).toBe('jpg.soi');
    expect(s.regions.at(-1)?.key).toBe('jpg.eoi');
    const sof = s.regions.find((r) => r.key.startsWith('jpg.markers.sof'));
    expect(sof?.values?.['width']).toBeGreaterThan(0);
    expect(s.regions.some((r) => r.key === 'jpg.scan')).toBe(true);
  });

  it('counts GIF frames', async () => {
    const s = await structure(fixture('sample-animated.gif'), 'gif');
    expect(s.regions.filter((r) => r.key === 'gif.image').length).toBeGreaterThan(1);
  });

  it('finds the PDF end and what comes after it', async () => {
    const pdf = enc('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\nstartxref\n9\n%%EOF\n');
    const bytes = concat(pdf, enc('extra'));
    const s = await structure(bytes, 'pdf');
    expectContiguous(s, bytes.length);
    expect(s.regions[0]?.values).toEqual({ version: '1.7' });
    expect(s.appendedAt).toBe(pdf.length);
  });

  it('gives up quietly on broken or unknown files', async () => {
    expect(await parseStructure(bytesReader(enc('nothing here')), 'zip')).toBeNull();
    expect(await parseStructure(bytesReader(enc('x')), 'mp3')).toBeNull();
    const broken = await structure(concat(tinyPng.subarray(0, 8), enc('????')), 'png');
    expect(broken.regions).toHaveLength(1);
  });

  it('finds the region of a byte', async () => {
    const s = await structure(tinyPng, 'png');
    expect(regionAt(s.regions, 0)?.key).toBe('png.signature');
    expect(regionAt(s.regions, 12)?.label).toBe('IHDR');
    expect(regionAt(s.regions, tinyPng.length)).toBeNull();
  });
});

describe('entropy', () => {
  it('is 0 for one repeated byte and 8 for all bytes equally often', () => {
    expect(shannonEntropy(new Uint8Array(100))).toBe(0);
    expect(shannonEntropy(Uint8Array.from({ length: 256 }, (_, i) => i))).toBeCloseTo(8);
  });

  it('profiles a file block by block', async () => {
    const bytes = concat(
      new Uint8Array(1024),
      Uint8Array.from({ length: 1024 }, (_, i) => i % 256),
    );
    const p = await entropyProfile(bytesReader(bytes), { blocks: 2 });
    expect(p.blockSize).toBe(1024);
    expect(p.blocks[0]).toBe(0);
    expect(p.blocks[1]).toBeCloseTo(8);
    expect(p.sampled).toBe(false);
    expect(entropyLevel(p.blocks[1] ?? 0)).toBe('random');
    expect(entropyLevel(4.5)).toBe('structured');
  });

  it('samples big files', async () => {
    const p = await entropyProfile(bytesReader(new Uint8Array(10_000)), {
      blocks: 2,
      sampleBytes: 1000,
    });
    expect(p.sampled).toBe(true);
    expect(p.blocks).toHaveLength(2);
  });
});

describe('hashes', () => {
  const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  it('reads pasted checksums in many shapes', () => {
    expect(parseHashInput(sha256.toUpperCase())).toBe(sha256);
    expect(parseHashInput(`SHA256: ${sha256}`)).toBe(sha256);
    expect(parseHashInput(`${sha256}  datei.zip`)).toBe(sha256);
    expect(parseHashInput('d4:1d:8c:d9:8f:00:b2:04:e9:80:09:98:ec:f8:42:7e')).toBe(
      'd41d8cd98f00b204e9800998ecf8427e',
    );
    expect(parseHashInput('kein hash')).toBeNull();
  });

  it('says whether the checksum fits', () => {
    expect(compareHash(sha256, { sha256, blake3: 'x' })).toEqual({
      status: 'match',
      algorithm: 'sha256',
    });
    expect(compareHash('0'.repeat(64), { sha256, blake3: 'y' })).toEqual({
      status: 'different',
      algorithms: ['sha256', 'blake3'],
    });
    expect(compareHash('0'.repeat(32), { sha256 })).toEqual({
      status: 'not-computed',
      algorithms: ['md5'],
    });
    expect(compareHash('zz', { sha256 })).toEqual({ status: 'invalid' });
  });
});

describe('search', () => {
  it('finds bytes forwards and backwards across windows', async () => {
    const { searchBytes, parseHexPattern } = await import('./index');
    const bytes = new Uint8Array(100);
    bytes.set([0xca, 0xfe], 10);
    bytes.set([0xca, 0xfe], 63);
    const r = bytesReader(bytes);
    const p = parseHexPattern('CA FE') ?? new Uint8Array();
    expect(await searchBytes(r, p, 0, false, 16)).toBe(10);
    expect(await searchBytes(r, p, 11, false, 16)).toBe(63);
    expect(await searchBytes(r, p, 99, true, 16)).toBe(63);
    expect(await searchBytes(r, p, 62, true, 16)).toBe(10);
    expect(await searchBytes(r, p, 64, false, 16)).toBe(-1);
    expect(parseHexPattern('0x89504E47')).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
    expect(parseHexPattern('hallo')).toBeNull();
  });
});

describe('age files', () => {
  it('are recognised by their first line', () => {
    const head = new TextEncoder().encode('age-encryption.org/v1\n-> X25519 abc\n');
    expect(identifyFile({ name: 'geheim.zip.age', detectedExt: null, head })).toMatchObject({
      realExt: 'age',
      verdict: 'match',
    });
    const armored = new TextEncoder().encode('-----BEGIN AGE ENCRYPTED FILE-----\nYWdl\n');
    expect(identifyFile({ name: 'brief', detectedExt: null, head: armored }).realExt).toBe('age');
  });
});
