/** Hands a file to the browser's download (and frees the memory right after). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "0x1A2B" or "6699" → 6699; null when it is neither. */
export function parseOffset(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(t)) return Number.parseInt(t.slice(2), 16);
  if (/^\d+$/.test(t)) return Number.parseInt(t, 10);
  if (/^[0-9a-f]+h$/.test(t)) return Number.parseInt(t.slice(0, -1), 16);
  return null;
}

export function hex(value: number, digits: number): string {
  return value.toString(16).toUpperCase().padStart(digits, '0');
}

/** The byte as a readable character, or a dot. */
export function printable(byte: number): string {
  return byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '·';
}
