import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createZip, uniqueNames, zipFileName } from './zip';

describe('uniqueNames', () => {
  it('numbers duplicates and keeps the extension', () => {
    expect(uniqueNames(['a.webp', 'a.webp', 'b.png', 'A.webp', 'a (2).webp'])).toEqual([
      'a.webp',
      'a (2).webp',
      'b.png',
      'A (3).webp',
      'a (2) (2).webp',
    ]);
  });

  it('removes path separators', () => {
    expect(uniqueNames(['../evil.png', 'dir\\x.png'])).toEqual(['.._evil.png', 'dir_x.png']);
  });
});

describe('createZip', () => {
  it('packs all files so that they can be unpacked again', async () => {
    const progress: number[] = [];
    const zip = await createZip(
      [
        { name: 'eins.webp', blob: new Blob(['first']) },
        { name: 'eins.webp', blob: new Blob(['second']) },
        { name: 'Übersee.png', blob: new Blob([new Uint8Array(200_000).fill(7)]) },
      ],
      (done) => progress.push(done),
    );
    expect(zip.type).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['eins (2).webp', 'eins.webp', 'Übersee.png'].sort());
    expect(new TextDecoder().decode(files['eins (2).webp'])).toBe('second');
    expect(files['Übersee.png']?.length).toBe(200_000);
    expect(progress).toEqual([1, 2, 3]);
  });
});

describe('zipFileName', () => {
  it('contains the date and time', () => {
    expect(zipFileName(new Date(2026, 9, 25, 9, 5))).toBe('conbert-2026-10-25-0905.zip');
  });
});
