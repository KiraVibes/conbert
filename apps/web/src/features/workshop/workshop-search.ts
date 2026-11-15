/**
 * Search in the workshop overview: case, accents and ß don't matter
 * ("grosse" finds "Größe"), every word typed must appear somewhere.
 */
export function searchKey(text: string): string {
  return text.toLocaleLowerCase('de').replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '');
}

export function matchesSearch(query: string, haystack: string): boolean {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = searchKey(haystack);
  return words.every((w) => text.includes(w));
}
