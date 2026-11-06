import { describe, expect, it } from 'vitest';
import { ocrmypdfArgs, resolveOcr } from './ocr';

describe('OCR settings', () => {
  it('only lets known values through', () => {
    expect(resolveOcr({})).toEqual({
      languages: 'deu+eng',
      mode: 'skip',
      rotate: true,
      deskew: false,
    });
    expect(resolveOcr({ ocrLanguage: 'deu; rm -rf /', ocrMode: 'evil' })).toMatchObject({
      languages: 'deu+eng',
      mode: 'skip',
    });
    expect(resolveOcr({ ocrLanguage: 'eng', ocrMode: 'force', ocrRotate: false })).toEqual({
      languages: 'eng',
      mode: 'force',
      rotate: false,
      deskew: false,
    });
  });

  it('builds the ocrmypdf command line', () => {
    const args = ocrmypdfArgs('in.pdf', 'out.pdf', resolveOcr({ ocrDeskew: true }), 3);
    expect(args).toEqual([
      '--skip-text',
      '-l',
      'deu+eng',
      '--output-type',
      'pdf',
      '--optimize',
      '1',
      '--jobs',
      '3',
      '--rotate-pages',
      '--deskew',
      '--',
      'in.pdf',
      'out.pdf',
    ]);
  });

  it('never straightens pages when only redoing the text', () => {
    const args = ocrmypdfArgs('a', 'b', resolveOcr({ ocrMode: 'redo', ocrDeskew: true }), 1);
    expect(args).toContain('--redo-ocr');
    expect(args).not.toContain('--deskew');
  });
});
