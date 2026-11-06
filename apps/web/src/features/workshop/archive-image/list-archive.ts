/**
 * The names inside a RAR or 7Z, read with libarchive.js (the same WASM build
 * the archive engine uses). The workshop checks them for programs before an
 * archive may go into a picture. Null when the list can't be read (e.g. the
 * names themselves are encrypted).
 */
const WORKER_URL = '/wasm/libarchive/worker-bundle.js';
const TIMEOUT_MS = 30_000;

interface Entry {
  file: { name: string };
  path: string;
}

export async function archiveNames(file: File): Promise<string[] | null> {
  const lib = await import('libarchive.js');
  lib.Archive.init({ workerUrl: new URL(WORKER_URL, window.location.origin) });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
  const reader = await lib.Archive.open(file);
  try {
    const list = reader
      .getFilesArray()
      .then((entries) => (entries as Entry[]).map((e) => `${e.path}${e.file.name}`))
      .catch(() => null);
    return await Promise.race([list, timeout]);
  } finally {
    await reader.close().catch(() => undefined);
  }
}
