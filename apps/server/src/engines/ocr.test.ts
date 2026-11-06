import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runProcess } from '../lib/run-process';
import { hasCommand } from '../test/helpers';
import { ocrEngine } from './ocr';

// img2pdf comes with ocrmypdf as a Python module (no command of its own).
const installed = hasCommand('ocrmypdf', ['--version']) && hasCommand('python3', ['--version']);
const IMG2PDF = [
  'import sys, img2pdf',
  'layout = img2pdf.get_fixed_dpi_layout_fun((150, 150))',
  'open(sys.argv[2], "wb").write(img2pdf.convert(sys.argv[1], layout_fun=layout))',
].join('\n');

describe.skipIf(!installed)('OCR (real ocrmypdf)', () => {
  let dir: string;
  let scan: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'conbert-ocr-'));
    // A "scanned" page: text only as pixels, no text layer.
    const picture = path.join(dir, 'page.png');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="500">' +
      '<rect width="100%" height="100%" fill="white"/>' +
      '<text x="80" y="280" font-family="DejaVu Sans" font-size="80">Hallo Conbert Zauberhut</text>' +
      '</svg>';
    await sharp(Buffer.from(svg)).png().toFile(picture);
    scan = path.join(dir, 'scan.pdf');
    await runProcess('python3', ['-c', IMG2PDF, picture, scan]);
    await ocrEngine.init();
  }, 60_000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const textOf = async (file: string) =>
    (await runProcess('gs', ['-q', '-dSAFER', '-sDEVICE=txtwrite', '-o', '-', file])).stdout;

  it('makes a scanned page searchable', async () => {
    expect(ocrEngine.status()).toBe('ready');
    expect(await textOf(scan)).not.toMatch(/Conbert/);
    const progress: number[] = [];
    const out = await ocrEngine.convert({
      input: scan,
      inputExt: 'pdf',
      outputExt: 'pdf',
      options: { ocrLanguage: 'deu' },
      workDir: path.join(dir, 'job'),
      onProgress: (p) => progress.push(p.percent),
    });
    expect(await textOf(String(out))).toMatch(/Conbert\s+Zauberhut/);
    expect(progress.at(-1)).toBe(100);
  }, 120_000);

  it('explains files that are no PDFs', async () => {
    const fake = path.join(dir, 'fake.pdf');
    await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } })
      .png()
      .toFile(fake);
    await expect(
      ocrEngine.convert({
        input: fake,
        inputExt: 'pdf',
        outputExt: 'pdf',
        options: {},
        workDir: path.join(dir, 'job2'),
      }),
    ).rejects.toMatchObject({ messageKey: expect.stringMatching(/errors\.(pdfBroken|ocrFailed)/) });
  }, 60_000);
});
