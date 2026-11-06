import { create } from 'zustand';
import { createId } from '@/lib/id';
import type { FileItem, FileTask } from '@/features/convert/files-store';

/**
 * The archive: every finished conversion or compression, newest first.
 * It lives in this browser (see history-persistence.ts) – an entry is gone
 * from the list as soon as its file is gone from the archive.
 */
export interface HistoryEntry {
  id: string;
  /** The file in the list it came from (renaming there renames it here too). */
  itemId?: string;
  createdAt: number;
  task: FileTask;
  sourceName: string;
  sourceExt: string;
  sourceSize: number;
  result: Blob;
  ext: string;
  fileName: string;
  /** Compressing would have made it bigger – the original was kept. */
  keptOriginal: boolean;
}

interface HistoryState {
  entries: HistoryEntry[];
  /** Entries from earlier visits are loaded. */
  loaded: boolean;
  add: (entry: HistoryEntry) => void;
  remove: (id: string) => void;
  clear: () => void;
  replaceAll: (entries: HistoryEntry[]) => void;
  renameFrom: (itemId: string, fileName: string) => void;
}

const newestFirst = (a: HistoryEntry, b: HistoryEntry) => b.createdAt - a.createdAt;

/** One object URL per archived file for thumbnails, freed when the entry goes. */
const urls = new Map<string, string>();

export function entryUrl(entry: HistoryEntry): string {
  let url = urls.get(entry.id);
  if (!url) {
    url = URL.createObjectURL(entry.result);
    urls.set(entry.id, url);
  }
  return url;
}

function forgetUrls(keep: readonly HistoryEntry[]): void {
  const ids = new Set(keep.map((e) => e.id));
  for (const [id, url] of urls) {
    if (!ids.has(id)) {
      URL.revokeObjectURL(url);
      urls.delete(id);
    }
  }
}

export const useHistory = create<HistoryState>()((set) => ({
  entries: [],
  loaded: false,
  add: (entry) =>
    set((s) => ({
      entries: [entry, ...s.entries.filter((e) => e.id !== entry.id)].sort(newestFirst),
    })),
  remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
  clear: () => set({ entries: [] }),
  replaceAll: (entries) => set({ entries: [...entries].sort(newestFirst), loaded: true }),
  renameFrom: (itemId, fileName) =>
    set((s) => ({
      entries: s.entries.map((e) => (e.itemId === itemId ? { ...e, fileName } : e)),
    })),
}));

/** Puts a finished file into the archive. */
export function recordResult(item: FileItem): void {
  const result = item.result;
  if (!result) return;
  useHistory.getState().add({
    id: createId(),
    itemId: item.id,
    createdAt: Date.now(),
    task: item.task,
    sourceName: item.name,
    sourceExt: item.ext,
    sourceSize: item.file.size,
    result: result.blob,
    ext: result.ext,
    fileName: result.fileName,
    keptOriginal: result.keptOriginal === true,
  });
}

// Free thumbnail URLs of entries that left the archive.
useHistory.subscribe((state) => forgetUrls(state.entries));
