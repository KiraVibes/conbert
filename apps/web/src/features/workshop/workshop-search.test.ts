import { describe, expect, it } from 'vitest';
import { matchesSearch } from './workshop-search';

describe('workshop search', () => {
  it('ignores case, accents and ß', () => {
    expect(matchesSearch('GROSS', 'Warum so groß?')).toBe(true);
    expect(matchesSearch('lithophanie', 'Lithophánie & Relief')).toBe(true);
    expect(matchesSearch('passwort', 'Passwort-Paket')).toBe(true);
  });
  it('needs every word, in any order', () => {
    expect(matchesSearch('pdf versteckt', 'Findet versteckten Text im PDF')).toBe(true);
    expect(matchesSearch('pdf video', 'Findet versteckten Text im PDF')).toBe(false);
  });
  it('an empty search matches everything', () => {
    expect(matchesSearch('   ', 'irgendwas')).toBe(true);
  });
});
