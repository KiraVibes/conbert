import { describe, expect, it } from 'vitest';
import { CATEGORIES } from './engine';
import {
  FORMATS,
  conversionWarnings,
  formatI18nKeys,
  getFormat,
  normalizeExt,
  recommendedTargets,
  refineDetectedExt,
} from './formats';

describe('format registry', () => {
  it('has unique extensions and aliases', () => {
    const all = FORMATS.flatMap((f) => [f.ext, ...(f.aliases ?? [])]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('uses canonical lowercase extensions without dots', () => {
    for (const f of FORMATS) {
      expect(f.ext).toMatch(/^[a-z0-9]+$/);
      for (const a of f.aliases ?? []) expect(a).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('gives every format a valid category, a mime type and the required text keys', () => {
    for (const f of FORMATS) {
      expect(CATEGORIES).toContain(f.category);
      expect(f.mime).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
      expect(f.nameKey).toBe(`formats.${f.ext}.name`);
      expect(formatI18nKeys(f)).toEqual(
        expect.arrayContaining([f.nameKey, f.summaryKey, f.goodForKey]),
      );
    }
  });
});

describe('normalizeExt', () => {
  it.each([
    ['png', 'png'],
    ['.PNG', 'png'],
    ['JPEG', 'jpg'],
    ['photo.final.JPG', 'jpg'],
    ['scan.tif', 'tiff'],
    ['unknown.XYZ', 'xyz'],
    [' webp ', 'webp'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeExt(input)).toBe(expected);
  });
});

describe('getFormat', () => {
  it('resolves aliases', () => {
    expect(getFormat('jpeg')?.ext).toBe('jpg');
  });
  it('returns undefined for unknown formats', () => {
    expect(getFormat('nope')).toBeUndefined();
  });
});

describe('recommendedTargets', () => {
  it('recommends image formats for images, but never the input format', () => {
    expect(recommendedTargets('webp')).toEqual(['jpg', 'png']);
    expect(recommendedTargets('tiff')).toEqual(['webp', 'jpg', 'png']);
  });
  it('returns nothing for unknown formats', () => {
    expect(recommendedTargets('nope')).toEqual([]);
  });
});

describe('conversionWarnings', () => {
  it('warns when transparency is lost', () => {
    expect(conversionWarnings('png', 'jpg')).toEqual(['transparencyLost', 'lossy']);
  });
  it('warns when animation is lost', () => {
    expect(conversionWarnings('gif', 'png')).toEqual(['animationLost']);
  });
  it('has no warnings for a lossless target that keeps everything', () => {
    expect(conversionWarnings('jpg', 'png')).toEqual([]);
  });
  it('returns nothing for unknown formats', () => {
    expect(conversionWarnings('png', 'nope')).toEqual([]);
  });
  it('warns that only the sound is kept from a video', () => {
    expect(conversionWarnings('mp4', 'mp3')).toEqual(['onlyAudio', 'lossy']);
    expect(conversionWarnings('mov', 'flac')).toEqual(['onlyAudio']);
  });
  it('warns that plain text loses formatting', () => {
    expect(conversionWarnings('docx', 'txt')).toEqual(['formattingLost']);
    expect(conversionWarnings('md', 'html')).toEqual([]);
  });
});

describe('refineDetectedExt', () => {
  it('prefers the name for formats in the same container', () => {
    expect(refineDetectedExt(normalizeExt('asf'), 'wma')).toBe('wma');
    expect(refineDetectedExt(normalizeExt('asf'), null)).toBe('wmv');
    expect(refineDetectedExt('mp4', 'm4a')).toBe('m4a');
    // An SVG with an XML declaration is still an SVG.
    expect(refineDetectedExt('xml', 'svg')).toBe('svg');
  });
  it('trusts the content when the name claims something unrelated', () => {
    expect(refineDetectedExt('png', 'jpg')).toBe('png');
    expect(refineDetectedExt('mp4', 'mp3')).toBe('mp4');
  });
});
