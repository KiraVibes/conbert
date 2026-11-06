/**
 * Collects files from a drop or paste, including the contents of dropped
 * folders (recursively). Hidden files like .DS_Store are skipped.
 */
export async function collectFiles(data: DataTransfer): Promise<File[]> {
  const entries: FileSystemEntry[] = [];
  const looseFiles: File[] = [];

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const file = item.getAsFile();
      if (file) looseFiles.push(file);
    }
  }

  if (entries.length === 0 && looseFiles.length === 0) {
    return filterHidden(Array.from(data.files ?? []));
  }

  const nested = await Promise.all(entries.map(readEntry));
  return filterHidden([...looseFiles, ...nested.flat()]);
}

function filterHidden(files: File[]): File[] {
  return files.filter((f) => !f.name.startsWith('.') && f.name !== 'Thumbs.db');
}

async function readEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([file]),
        () => resolve([]),
      );
    });
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    // readEntries returns results in batches until it returns an empty array.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(resolve, () => resolve([]));
      });
      if (batch.length === 0) break;
      children.push(...batch);
    }
    const files = await Promise.all(children.map(readEntry));
    return files.flat();
  }
  return [];
}
