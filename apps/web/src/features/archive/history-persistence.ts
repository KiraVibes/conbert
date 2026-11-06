import { useEffect } from 'react';
import { useFiles, type FileTask } from '@/features/convert/files-store';
import { useHistory, type HistoryEntry } from './history-store';

/**
 * Keeps the archive in IndexedDB in this browser, one database per user
 * account. Nothing leaves the device. Entries expire after 14 days, so the
 * browser storage doesn't fill up; removing an entry deletes its file.
 */

const STORE = 'entries';
export const ARCHIVE_DAYS = 14;
const MAX_AGE_MS = ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexeddb'));
  });
}

function openDb(name: string, store: string, keyPath: string): Promise<IDBDatabase> {
  const open = indexedDB.open(name, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(store, { keyPath });
  return request(open);
}

/**
 * Removed entries are also noted synchronously in localStorage: a reload right
 * after removing can abort the IndexedDB delete, and the file would come back.
 */
function removedKey(userId: string) {
  return `conbert-history-removed-${userId}`;
}
function readRemoved(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(removedKey(userId));
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}
function writeRemoved(userId: string, ids: Set<string>) {
  try {
    if (ids.size === 0) localStorage.removeItem(removedKey(userId));
    else localStorage.setItem(removedKey(userId), JSON.stringify([...ids]));
  } catch {
    // Storage blocked: the IndexedDB delete alone still works without a quick reload.
  }
}

interface OldArchiveItem {
  id: string;
  savedAt: number;
  task: FileTask;
  name: string;
  ext: string;
  file: Blob;
  result: { blob: Blob; ext: string; fileName: string; keptOriginal: boolean };
}

/** The first archive (downloaded files only) becomes part of the new one. */
async function migrateOldArchive(userId: string): Promise<HistoryEntry[]> {
  const name = `conbert-archive-${userId}`;
  const known = (await indexedDB.databases?.()) ?? [];
  if (!known.some((d) => d.name === name)) return [];
  const db = await openDb(name, 'items', 'id');
  const items = await request(
    db.transaction('items', 'readonly').objectStore('items').getAll() as IDBRequest<
      OldArchiveItem[]
    >,
  );
  db.close();
  indexedDB.deleteDatabase(name);
  return items.map((i) => ({
    id: i.id,
    createdAt: i.savedAt,
    task: i.task,
    sourceName: i.name,
    sourceExt: i.ext,
    sourceSize: i.file.size,
    result: i.result.blob,
    ext: i.result.ext,
    fileName: i.result.fileName,
    keptOriginal: i.result.keptOriginal,
  }));
}

/** Loads the archive, then mirrors every change into IndexedDB. */
export async function startHistoryPersistence(userId: string): Promise<() => void> {
  if (typeof indexedDB === 'undefined') {
    useHistory.setState({ loaded: true });
    return () => undefined;
  }
  const db = await openDb(`conbert-history-${userId}`, STORE, 'id');
  const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  const removed = readRemoved(userId);
  const stored = await request(store('readonly').getAll() as IDBRequest<HistoryEntry[]>);
  const saved = stored.filter((e) => !removed.has(e.id));
  const migrated = await migrateOldArchive(userId).catch(() => []);

  const now = Date.now();
  const all = [...saved, ...migrated];
  const fresh = all.filter((e) => now - e.createdAt < MAX_AGE_MS);
  const expired = all.filter((e) => now - e.createdAt >= MAX_AGE_MS);
  if (expired.length > 0 || removed.size > 0) {
    const tx = db.transaction(STORE, 'readwrite');
    const s = tx.objectStore(STORE);
    for (const e of expired) s.delete(e.id);
    for (const id of removed) s.delete(id);
    tx.oncomplete = () => {
      const left = readRemoved(userId);
      for (const id of removed) left.delete(id);
      writeRemoved(userId, left);
    };
  }

  // Results finished before loading completed stay in the list too.
  const current = useHistory.getState().entries;
  useHistory
    .getState()
    .replaceAll([...current.filter((e) => !fresh.some((f) => f.id === e.id)), ...fresh]);
  // What is in IndexedDB, by entry object: a changed (renamed) entry is a new object.
  const persisted = new Map<string, HistoryEntry>();
  for (const entry of useHistory.getState().entries) {
    if (saved.some((s) => s.id === entry.id)) persisted.set(entry.id, entry);
  }

  const sync = (entries: readonly HistoryEntry[]) => {
    const ids = new Set(entries.map((e) => e.id));
    const writes = entries.filter((e) => persisted.get(e.id) !== e);
    const deletes = [...persisted.keys()].filter((id) => !ids.has(id));
    if (writes.length === 0 && deletes.length === 0) return;
    const tx = db.transaction(STORE, 'readwrite');
    const s = tx.objectStore(STORE);
    if (deletes.length > 0) {
      const pending = readRemoved(userId);
      for (const id of deletes) pending.add(id);
      writeRemoved(userId, pending);
      tx.oncomplete = () => {
        const left = readRemoved(userId);
        for (const id of deletes) left.delete(id);
        writeRemoved(userId, left);
      };
    }
    for (const entry of writes) {
      persisted.set(entry.id, entry);
      // A full browser storage only means this file isn't kept after a reload.
      s.put(entry).onerror = (e) => {
        e.preventDefault();
        persisted.delete(entry.id);
      };
    }
    for (const id of deletes) {
      persisted.delete(id);
      s.delete(id);
    }
  };
  sync(useHistory.getState().entries);
  const unsubscribe = useHistory.subscribe((state) => sync(state.entries));
  return () => {
    unsubscribe();
    db.close();
  };
}

/** Starts the archive for the signed-in user; logging out empties everything in memory. */
export function useHistoryPersistence(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    startHistoryPersistence(userId)
      .then((s) => {
        if (cancelled) s();
        else stop = s;
      })
      .catch((error: unknown) => {
        console.warn('archive could not be loaded', error);
        useHistory.setState({ loaded: true });
      });
    return () => {
      cancelled = true;
      stop?.();
      // Logged out or another account: its files must not stay visible.
      useHistory.setState({ entries: [], loaded: false });
      useFiles.getState().reset();
    };
  }, [userId]);
}
