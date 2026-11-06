/** "Heute", "Gestern" or the date – headings for the list. */
export function dayLabel(timestamp: number, language: string, t: (key: string) => string): string {
  const day = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(day, today)) return t('archive.today');
  if (same(day, yesterday)) return t('archive.yesterday');
  return day.toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'long' });
}
