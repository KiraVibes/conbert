import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseMetadata, writeMetadata } from '@uswriting/exiftool';
import { describe, expect, it } from 'vitest';
import {
  METADATA_FIELDS,
  commonFields,
  exiftoolSecretWrite,
  exiftoolWrite,
  messageFields,
  metaSpotFor,
  hasLocation,
  type MetadataEdits,
  type MetadataTags,
} from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import { writePdfSubject } from '../workshop/meta-secret/write-secret';

/**
 * The real ExifTool (WebAssembly) with Conbert's field mapping: what the
 * metadata tab writes must come back when reading. The WASM file is handed
 * over like in the browser (custom fetch), which also works on Windows.
 */
const require = createRequire(import.meta.url);
const wasm = path.join(
  path
    .dirname(createRequire(require.resolve('@uswriting/exiftool')).resolve('@6over3/zeroperl-ts'))
    .replace(/([\\/])cjs$/, '$1esm'),
  'zeroperl.wasm',
);
const fetchWasm = () =>
  Promise.resolve(
    new Response(readFileSync(wasm), { headers: { 'content-type': 'application/wasm' } }),
  );
const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(import.meta.dirname, '../../engines/__fixtures__', name)));

async function read(name: string, data: Uint8Array): Promise<MetadataTags> {
  const result = await parseMetadata(
    { name, data },
    {
      args: ['-json', '-G1', '-a'],
      fetch: fetchWasm,
      transform: (d) => JSON.parse(d) as MetadataTags[],
    },
  );
  if (!result.success) throw new Error(result.error);
  return result.data[0] ?? {};
}

async function write(name: string, data: Uint8Array, edits: MetadataEdits): Promise<Uint8Array> {
  const ext = name.split('.').pop() ?? '';
  const { tags, args } = exiftoolWrite(ext, edits);
  const result = await writeMetadata({ name, data }, tags, { args, fetch: fetchWasm });
  if (!result.success) throw new Error(result.error);
  return new Uint8Array(result.data);
}

const ALL: MetadataEdits = {
  values: {
    title: 'Sonnenuntergang – Äpfel',
    description: 'Am Meer',
    author: 'Anna',
    copyright: '© 2026 Anna',
    keywords: 'Urlaub, Meer',
    date: '2026-07-01T20:15',
  },
  removeGps: false,
  removeAll: false,
};

describe('metadata with the real ExifTool', { timeout: 120_000 }, () => {
  for (const name of ['sample.jpg', 'sample.png', 'sample.mp4']) {
    it(`writes every field into ${name} and reads it back`, async () => {
      const written = await write(name, fixture(name), ALL);
      expect(commonFields(await read(name, written))).toEqual({
        ...ALL.values,
        keywords: 'Urlaub, Meer',
      });
    });
  }

  it('removes the location and everything else on request', async () => {
    const withGps = await write('sample.jpg', fixture('sample.jpg'), ALL);
    const { tags } = exiftoolWrite('jpg', { values: {}, removeGps: false, removeAll: false });
    const gps = await writeMetadata(
      { name: 'sample.jpg', data: withGps },
      {
        ...tags,
        'GPS:GPSLatitude': '54.1',
        'GPS:GPSLatitudeRef': 'N',
        'GPS:GPSLongitude': '10.5',
        'GPS:GPSLongitudeRef': 'E',
      },
      { args: ['-m'], fetch: fetchWasm },
    );
    if (!gps.success) throw new Error(gps.error);
    const located = new Uint8Array(gps.data);
    expect(hasLocation(await read('sample.jpg', located))).toBe(true);

    const noGps = await write('sample.jpg', located, {
      values: {},
      removeGps: true,
      removeAll: false,
    });
    const after = await read('sample.jpg', noGps);
    expect(hasLocation(after)).toBe(false);
    expect(commonFields(after).author).toBe('Anna');

    const clean = await write('sample.jpg', located, {
      values: { title: 'Nur das' },
      removeGps: false,
      removeAll: true,
    });
    expect(commonFields(await read('sample.jpg', clean))).toEqual({ title: 'Nur das' });
  });

  it('reads files it cannot write, and says so when writing', async () => {
    expect(Object.keys(await read('sample.mp3', fixture('sample.mp3'))).length).toBeGreaterThan(5);
    await expect(write('sample.mp3', fixture('sample.mp3'), ALL)).rejects.toThrow(/MP3/);
  });
});

describe('metadata texts', () => {
  it('every field has its label, help and example in German and English', () => {
    expect(
      findMissingKeys(
        METADATA_FIELDS.flatMap((f) => [
          `metadata.fields.${f}.label`,
          `metadata.fields.${f}.help`,
          `metadata.fields.${f}.placeholder`,
        ]),
      ),
    ).toEqual([]);
  });
});

describe('secret message in metadata with the real ExifTool', { timeout: 120_000 }, () => {
  for (const name of ['sample.jpg', 'sample.png', 'sample-animated.gif', 'sample.mp4']) {
    it(`hides a message in ${name} and finds it again`, async () => {
      const ext = name.split('.').pop() ?? '';
      const spot = metaSpotFor(ext);
      if (!spot || spot === 'audio' || spot === 'pdf') throw new Error('no spot');
      const { tags, args } = exiftoolSecretWrite(spot, 'Treffpunkt: alte Eiche');
      const result = await writeMetadata({ name, data: fixture(name) }, tags, {
        args,
        fetch: fetchWasm,
      });
      if (!result.success) throw new Error(result.error);
      const fields = messageFields(await read(name, new Uint8Array(result.data)));
      expect(fields.map((f) => f.value)).toContain('Treffpunkt: alte Eiche');
    });
  }

  it('hides a message in a PDF (pdf-lib) that ExifTool reads back', async () => {
    const pdf = await writePdfSubject(new Blob([fixture('sample.pdf')]), 'CNBZ1:abc');
    const fields = messageFields(await read('sample.pdf', new Uint8Array(await pdf.arrayBuffer())));
    expect(fields).toContainEqual({ key: 'PDF:Subject', value: 'CNBZ1:abc', sealed: true });
  });
});
