import { describe, expect, it } from 'vitest';
import { canPreviewInBrowser, detectFileType } from './detect-type';
import { formatBytes } from './format-bytes';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function fileFromBase64(base64: string, name: string): File {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new File([bytes], name);
}

describe('detectFileType', () => {
  it('detects a PNG by its content', async () => {
    const result = await detectFileType(fileFromBase64(PNG_1X1, 'pixel.png'));
    expect(result).toEqual({ ext: 'png', detectedExt: 'png', nameExt: 'png', mismatch: false });
  });

  it('flags a file whose name lies about its type', async () => {
    const result = await detectFileType(fileFromBase64(PNG_1X1, 'pixel.jpeg'));
    expect(result.ext).toBe('png');
    expect(result.nameExt).toBe('jpg');
    expect(result.mismatch).toBe(true);
  });

  it('falls back to the file name for text formats without magic bytes', async () => {
    const result = await detectFileType(new File(['a,b\n1,2'], 'data.csv'));
    expect(result).toMatchObject({ ext: 'csv', detectedExt: null, mismatch: false });
  });

  it('returns an empty extension when nothing is known', async () => {
    const result = await detectFileType(new File(['???'], 'README'));
    expect(result.ext).toBe('');
  });
});

describe('canPreviewInBrowser', () => {
  it('knows which image formats a browser can show', () => {
    expect(canPreviewInBrowser('png')).toBe(true);
    expect(canPreviewInBrowser('tiff')).toBe(false);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, 'de', '0 B'],
    [1536, 'de', '1,5 KB'],
    [1536, 'en', '1.5 KB'],
    [5 * 1024 * 1024, 'de', '5 MB'],
    [123.4 * 1024 * 1024, 'en', '123 MB'],
    [-1, 'de', '–'],
  ])('%d bytes (%s) → %s', (bytes, lang, expected) => {
    expect(formatBytes(bytes, lang)).toBe(expected);
  });
});
