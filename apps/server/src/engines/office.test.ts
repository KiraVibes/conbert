import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { engineI18nKeys, getFormat, type Engine } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import { runProcess } from '../lib/run-process';
import { hasCommand } from '../test/helpers';
import { archivesEngine, unpackedSize } from './archives';
import { calibreEngine } from './calibre';
import { dataServerEngine } from './data';
import { fonttoolsEngine } from './fonttools';
import {
  libreofficeCalcEngine,
  libreofficeImpressEngine,
  libreofficeWriterEngine,
} from './libreoffice';
import { pdfToolsEngine } from './pdf-tools';

const fixtures = path.join(import.meta.dirname, '../__fixtures__');
let workDir: string;
beforeAll(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-p6-'));
});
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

const ENGINES = [
  libreofficeWriterEngine,
  libreofficeCalcEngine,
  libreofficeImpressEngine,
  pdfToolsEngine,
  calibreEngine,
  archivesEngine,
  fonttoolsEngine,
  dataServerEngine,
];

async function run(
  engine: Engine,
  from: string,
  to: string,
  options: Record<string, unknown> = {},
) {
  const output = await engine.convert({
    input: path.join(fixtures, `sample.${from}`),
    inputExt: from,
    outputExt: to,
    options,
    workDir,
  });
  return readFileSync(output as string);
}

const head = (bytes: Buffer, n: number) => bytes.subarray(0, n).toString('latin1');

describe('Phase 6 engine definitions', () => {
  it('have texts and registry entries', () => {
    for (const engine of ENGINES) {
      expect(findMissingKeys(engineI18nKeys(engine)), engine.id).toEqual([]);
      for (const f of engine.formats)
        expect(getFormat(f.ext), `${engine.id}: ${f.ext}`).toBeDefined();
    }
  });

  it('measures archives before unpacking', () => {
    const listing = [
      '-rw-r--r--  0 root   root       3 Oct 25 21:35 hallo.txt',
      '-rw-r--r--  0 root   root   10000 Oct 25 21:35 ordner/eine datei.txt',
    ].join('\n');
    expect(unpackedSize(listing)).toEqual({ entries: 2, bytes: 10003 });
  });
});

describe('data formats on the server', () => {
  it('turns a CSV into an Excel file', async () => {
    expect(head(await run(dataServerEngine, 'csv', 'xlsx'), 2)).toBe('PK');
  });
});

describe.skipIf(!hasCommand('soffice', ['--version']))('LibreOffice (real)', () => {
  beforeAll(() => Promise.all([libreofficeWriterEngine.init(), libreofficeCalcEngine.init()]));

  it.each([
    [libreofficeWriterEngine, 'docx', 'pdf', '%PDF'],
    [libreofficeWriterEngine, 'doc', 'docx', 'PK'],
    [libreofficeWriterEngine, 'docx', 'odt', 'PK'],
    [libreofficeCalcEngine, 'xlsx', 'pdf', '%PDF'],
    [libreofficeCalcEngine, 'xls', 'xlsx', 'PK'],
    [libreofficeCalcEngine, 'csv', 'ods', 'PK'],
    [libreofficeImpressEngine, 'pptx', 'pdf', '%PDF'],
    [libreofficeImpressEngine, 'odp', 'pptx', 'PK'],
  ] as const)(
    '%s: %s → %s',
    async (engine, from, to, magic) => {
      expect(head(await run(engine, from, to), magic.length)).toBe(magic);
    },
    120_000,
  );

  it('reads a German CSV (semicolons, umlauts) correctly', async () => {
    const csv = (await run(libreofficeCalcEngine, 'csv', 'csv')).toString('utf8');
    // LibreOffice quotes text cells – valid CSV; what matters is that umlauts survive.
    expect(csv).toMatch(/"?Jörg"?,"?München"?,17/);
  }, 120_000);
});

describe.skipIf(!hasCommand('gs', ['--version']) || !hasCommand('qpdf', ['--version']))(
  'PDF tools (real)',
  () => {
    it('shrinks a PDF losslessly and with Ghostscript', async () => {
      expect(head(await run(pdfToolsEngine, 'pdf', 'pdf', { pdfQuality: 'lossless' }), 4)).toBe(
        '%PDF',
      );
      expect(head(await run(pdfToolsEngine, 'pdf', 'pdf', { pdfQuality: 'screen' }), 4)).toBe(
        '%PDF',
      );
    }, 60_000);

    it('renders page 2 as PNG and explains a missing page', async () => {
      expect(head(await run(pdfToolsEngine, 'pdf', 'png', { pdfPage: 2 }), 4)).toBe('\x89PNG');
      await expect(run(pdfToolsEngine, 'pdf', 'jpg', { pdfPage: 9 })).rejects.toMatchObject({
        messageKey: 'errors.convertFailed',
      });
    }, 60_000);
  },
);

describe.skipIf(!hasCommand('ebook-convert', ['--version']))('Calibre (real, full edition)', () => {
  it.each([
    ['epub', 'mobi', 'BOOKMOBI'],
    ['mobi', 'epub', 'PK'],
    ['fb2', 'azw3', 'BOOKMOBI'],
  ])(
    '%s → %s',
    async (from, to, magic) => {
      const bytes = await run(calibreEngine, from, to);
      const at = magic === 'BOOKMOBI' ? 60 : 0;
      expect(bytes.subarray(at, at + magic.length).toString('latin1')).toBe(magic);
    },
    180_000,
  );
});

describe.skipIf(!hasCommand('bsdtar', ['--version']))('archives (real)', () => {
  async function list(bytes: Buffer, ext: string): Promise<string[]> {
    const file = path.join(workDir, `check-${Date.now()}.${ext}`);
    await import('node:fs/promises').then((fs) => fs.writeFile(file, bytes));
    const { stdout } = await runProcess('bsdtar', ['-t', '-f', file]);
    return stdout.split('\n').filter(Boolean).sort();
  }

  it.each([
    ['zip', '7z'],
    ['7z', 'tgz'],
    ['tgz', 'zip'],
  ])(
    'repacks %s → %s with all files',
    async (from, to) => {
      const files = await list(await run(archivesEngine, from, to, { archiveLevel: 'max' }), to);
      expect(files).toEqual(expect.arrayContaining(['hallo.txt', 'ordner/zwei.txt']));
    },
    60_000,
  );
});

describe.skipIf(!hasCommand('python3', ['-c', 'import fontTools, brotli']))(
  'fonttools (real)',
  () => {
    it('converts TTF ↔ WOFF2 and subsets', async () => {
      const woff2 = await run(fonttoolsEngine, 'ttf', 'woff2');
      expect(head(woff2, 4)).toBe('wOF2');
      const ttf = await run(fonttoolsEngine, 'woff2', 'ttf');
      expect([...ttf.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
      const subset = await run(fonttoolsEngine, 'ttf', 'woff', { fontSubset: 'latin' });
      expect(head(subset, 4)).toBe('wOFF');
    }, 60_000);
  },
);
