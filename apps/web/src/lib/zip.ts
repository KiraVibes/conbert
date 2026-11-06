import { Zip, ZipPassThrough } from 'fflate';

export interface ZipEntry {
  name: string;
  blob: Blob;
}

/**
 * Makes file names unique inside one archive:
 * "photo.webp", "photo.webp" → "photo.webp", "photo (2).webp".
 */
export function uniqueNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((original) => {
    const name = original.replace(/[\\/]/g, '_') || 'file';
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; ; n++) {
      const candidate = `${base} (${n})${ext}`;
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase());
        return candidate;
      }
    }
  });
}

/**
 * Packs files into a ZIP without compressing them again (images, audio and
 * video are compressed already – this is fast and keeps memory low).
 * Files are streamed one after another.
 */
export async function createZip(
  entries: readonly ZipEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let failure: Error | null = null;
  const finished = new Promise<void>((resolve, reject) => {
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        failure = error;
        reject(error);
        return;
      }
      parts.push(chunk as Uint8Array<ArrayBuffer>);
      if (final) resolve();
    });
    const names = uniqueNames(entries.map((e) => e.name));
    void (async () => {
      try {
        for (const [index, entry] of entries.entries()) {
          const file = new ZipPassThrough(names[index] ?? `file-${index + 1}`);
          file.mtime = new Date();
          zip.add(file);
          if (typeof entry.blob.stream === 'function') {
            // Stream in chunks so large files are never fully duplicated.
            const reader = entry.blob.stream().getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              file.push(value);
            }
            file.push(new Uint8Array(0), true);
          } else {
            file.push(new Uint8Array(await entry.blob.arrayBuffer()), true);
          }
          onProgress?.(index + 1, entries.length);
          if (failure) return;
        }
        zip.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
  await finished;
  return new Blob(parts, { type: 'application/zip' });
}

/** "conbert-2026-10-25-1432.zip" */
export function zipFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `conbert-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}.zip`;
}

/** Starts a download of a blob in the browser. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before freeing it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
