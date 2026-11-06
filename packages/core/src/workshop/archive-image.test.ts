import { readFileSync } from 'node:fs';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  PNG_ZIP_CHUNK,
  WorkshopError,
  bytesReader,
  crc32,
  decodeRaster,
  detectiveScan,
  hideArchiveInPicture,
  makePolyglot,
  packZip,
  parseStructure,
  unlockZipEntry,
} from './index';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../apps/web/src/engines/__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const latin1 = new TextDecoder('latin1');

const smallZip = () =>
  zipSync({ 'notiz.txt': strToU8('Abrakadabra'), 'ordner/b.txt': strToU8('zwei') });

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WorkshopError) return error.code;
    throw error;
  }
  return 'ok';
}

/** Every PNG block with its checksum – throws on a wrong one. */
function pngChunks(png: Uint8Array): string[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types: string[] = [];
  let p = 8;
  while (p + 12 <= png.length) {
    const length = view.getUint32(p);
    const type = latin1.decode(png.subarray(p + 4, p + 8));
    const crc = view.getUint32(p + 8 + length);
    if (crc32(png.subarray(p + 4, p + 8 + length)) !== crc) throw new Error(`bad CRC in ${type}`);
    types.push(type);
    p += 12 + length;
  }
  expect(p).toBe(png.length);
  return types;
}

describe('packZip', () => {
  it('packs files, makes names unique and encrypts with a password', async () => {
    const files = [
      { name: 'a.txt', data: strToU8('eins') },
      { name: 'a.txt', data: strToU8('zwei') },
    ];
    const plain = unzipSync(await packZip(files));
    expect(Object.keys(plain).sort()).toEqual(['a (2).txt', 'a.txt']);
    expect(strFromU8(plain['a (2).txt'] ?? new Uint8Array())).toBe('zwei');

    const locked = await packZip(files, 'geheim');
    expect(strFromU8(await unlockZipEntry(locked, 'a.txt', 'geheim'))).toBe('eins');
    expect(await code(unlockZipEntry(locked, 'a.txt', 'falsch'))).toBe('wrong-password');
  });

  it('refuses programs and scripts', async () => {
    expect(await code(packZip([{ name: 'tool.exe', data: strToU8('MZ') }]))).toBe('executable');
    expect(await code(packZip([{ name: 'x.txt', data: strToU8('#!/bin/sh\n') }]))).toBe(
      'executable',
    );
    expect(await code(packZip([]))).toBe('empty');
  });
});

describe('hideArchiveInPicture', () => {
  it('puts a ZIP behind a JPEG so that every ZIP program opens it', async () => {
    const jpg = fixture('sample.jpg');
    const out = await hideArchiveInPicture(jpg, smallZip());
    expect(out.subarray(0, jpg.length)).toEqual(jpg);
    // fflate reads the stored positions as they are – like the Windows Explorer.
    expect(strFromU8(unzipSync(out)['notiz.txt'] ?? new Uint8Array())).toBe('Abrakadabra');
    const { findings } = await detectiveScan(bytesReader(out), 'jpg');
    expect(findings[0]).toMatchObject({ kind: 'appended', format: 'zip', offset: jpg.length });
  });

  it('replaces data that already hung behind the picture', async () => {
    const png = fixture('sample.png');
    const once = await hideArchiveInPicture(png, smallZip());
    const twice = await hideArchiveInPicture(once, zipSync({ 'neu.txt': strToU8('neu') }));
    expect(Object.keys(unzipSync(twice))).toEqual(['neu.txt']);
  });

  it('keeps an AES-encrypted ZIP openable', async () => {
    const zip = await packZip([{ name: 'geheim.txt', data: strToU8('Schatz') }], 'pw');
    const out = await hideArchiveInPicture(fixture('sample-animated.gif'), zip);
    expect(strFromU8(await unlockZipEntry(out, 'geheim.txt', 'pw'))).toBe('Schatz');
  });

  it('takes RAR and 7Z only with a checked list of names', async () => {
    const sevenZip = fixture('sample.7z');
    const jpg = fixture('sample.jpg');
    expect(await code(hideArchiveInPicture(jpg, sevenZip))).toBe('unchecked');
    expect(await code(hideArchiveInPicture(jpg, sevenZip, ['ordner/start.bat']))).toBe(
      'executable',
    );
    const out = await hideArchiveInPicture(jpg, sevenZip, ['hallo.txt']);
    expect(out.length).toBe(jpg.length + sevenZip.length);
  });

  it('refuses archives with programs, wrong covers and non-archives', async () => {
    const jpg = fixture('sample.jpg');
    const bad = zipSync({ 'setup.exe': strToU8('MZ') });
    expect(await code(hideArchiveInPicture(jpg, bad))).toBe('executable');
    expect(await code(hideArchiveInPicture(fixture('sample.pdf'), smallZip()))).toBe('not-cover');
    expect(await code(hideArchiveInPicture(jpg, fixture('sample.png')))).toBe('not-archive');
  });
});

describe('makePolyglot', () => {
  it('PNG + ZIP: the ZIP lives in a block of its own, the PNG stays valid', async () => {
    const png = fixture('sample.png');
    const out = await makePolyglot(png, smallZip());
    const types = pngChunks(out);
    expect(types.at(-1)).toBe('IEND');
    expect(types.at(-2)).toBe(PNG_ZIP_CHUNK);
    expect((await parseStructure(bytesReader(out), 'png'))?.appendedAt).toBeNull();
    expect(decodeRaster(out)).toMatchObject(decodeRaster(png) ?? {});
    expect(strFromU8(unzipSync(out)['ordner/b.txt'] ?? new Uint8Array())).toBe('zwei');
    const { findings } = await detectiveScan(bytesReader(out), 'png');
    expect(findings.some((f) => f.hidden && f.format === 'zip')).toBe(true);
  });

  it('PDF + ZIP: an update section carries the ZIP, the PDF still points to its pages', async () => {
    const pdf = fixture('sample.pdf');
    const zip = await packZip([{ name: 'anhang.txt', data: strToU8('im PDF') }], 'pw');
    const out = await makePolyglot(pdf, zip);
    expect(out.subarray(0, pdf.length)).toEqual(pdf);
    const text = latin1.decode(out.subarray(pdf.length));
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
    expect(latin1.decode(out.subarray(startxref, startxref + 4))).toBe('xref');
    expect(text).toMatch(/trailer\n<< \/Size 9 \/Prev 627 \/Root 1 0 R >>/);
    // The table entry points at the new object.
    const at = Number(/xref\n8 1\n(\d{10}) 00000 n \n/.exec(text)?.[1]);
    expect(latin1.decode(out.subarray(at, at + 8))).toBe('8 0 obj\n');
    expect(strFromU8(await unlockZipEntry(out, 'anhang.txt', 'pw'))).toBe('im PDF');
    const { findings } = await detectiveScan(bytesReader(out), 'pdf');
    expect(findings.some((f) => f.hidden && f.format === 'zip')).toBe(true);
  });

  it('refuses locked PDFs and other hosts', async () => {
    const pdf = latin1.decode(fixture('sample.pdf'));
    const locked = strToU8(pdf.replace('/Root 1 0 R', '/Root 1 0 R /Encrypt 9 0 R'), true);
    expect(await code(makePolyglot(locked, smallZip()))).toBe('locked-pdf');
    expect(await code(makePolyglot(fixture('sample.jpg'), smallZip()))).toBe('not-cover');
  });
});
