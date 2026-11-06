import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HELP_GUIDES, guideHref } from './help';

const docs = fileURLToPath(new URL('../../../docs/', import.meta.url));

describe('guideHref', () => {
  it('links the German guide for German and the English one otherwise', () => {
    const nas = HELP_GUIDES[1];
    expect(nas.id).toBe('nas');
    expect(guideHref(nas, 'de')).toBe('/docs/speicherorte.md');
    expect(guideHref(nas, 'de-AT')).toBe('/docs/speicherorte.md');
    expect(guideHref(nas, 'en')).toBe('/docs/en/storage.md');
  });

  it('has every guide in both languages', () => {
    for (const g of HELP_GUIDES) {
      expect(existsSync(`${docs}${g.file}`), g.file).toBe(true);
      expect(existsSync(`${docs}en/${g.fileEn}`), `en/${g.fileEn}`).toBe(true);
    }
  });
});
