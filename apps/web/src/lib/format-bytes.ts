const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Human-readable file size in the given language: 1536 → "1,5 KB" (de) / "1.5 KB" (en). */
export function formatBytes(bytes: number, language = 'de'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const formatted = new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(
    value,
  );
  return `${formatted} ${UNITS[unit]}`;
}
