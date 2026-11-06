import { extFromName } from './identify';
import { looksExecutable } from './executable';
import { MAX_EXTRACT_BYTES, WorkshopError } from './zip-tools';

/**
 * Packing and unlocking ZIPs with zip.js (the only ZIP library here that
 * writes and reads AES-256 encryption). Loaded only when needed.
 */

export interface PackFile {
  name: string;
  data: Uint8Array;
}

async function zipjs() {
  const lib = await import('@zip.js/zip.js/index-native.js');
  // Workers are our own business (the workshop worker); native streams compress.
  lib.configure({ useWebWorkers: false });
  return lib;
}

/** "a.txt", "a.txt" → "a.txt", "a (2).txt" – names inside a ZIP must be unique. */
function uniqueName(name: string, used: Set<string>): string {
  const clean = name.replace(/[\\/]+/g, '_').replace(/^\.+/, '') || 'datei';
  let candidate = clean;
  const ext = extFromName(clean);
  const stem = ext ? clean.slice(0, -(ext.length + 1)) : clean;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) {
    candidate = ext ? `${stem} (${i}).${ext}` : `${stem} (${i})`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Packs files into a ZIP. With a password the content is encrypted with
 * AES-256 (WinZip AE-2): 7-Zip, WinRAR and Conbert open it, the Windows
 * Explorer does not. Programs and scripts are refused.
 */
export async function packZip(files: readonly PackFile[], password = ''): Promise<Uint8Array> {
  if (files.length === 0) throw new WorkshopError('empty');
  let total = 0;
  for (const f of files) {
    if (looksExecutable(f.name, f.data.subarray(0, 4096))) {
      throw new WorkshopError('executable', f.name);
    }
    total += f.data.length;
  }
  if (total > MAX_EXTRACT_BYTES) throw new WorkshopError('too-big', String(total));
  const { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } = await zipjs();
  const writer = new ZipWriter(
    new Uint8ArrayWriter(),
    password ? { password, encryptionStrength: 3 } : {},
  );
  const used = new Set<string>();
  for (const f of files) {
    await writer.add(uniqueName(f.name, used), new Uint8ArrayReader(f.data), { level: 6 });
  }
  return writer.close();
}

/**
 * One entry of a password-protected ZIP (AES or the old ZipCrypto), found by
 * the position of its header (names can be decoded differently) or its name.
 * `zip` must be a ZIP on its own (positions counted from its start).
 */
export async function unlockZipEntry(
  zip: Uint8Array,
  wanted: string | { name: string; offset: number },
  password: string,
): Promise<Uint8Array> {
  const name = typeof wanted === 'string' ? wanted : wanted.name;
  const offset = typeof wanted === 'string' ? null : wanted.offset;
  const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter, ERR_INVALID_PASSWORD } = await zipjs();
  const reader = new ZipReader(new Uint8ArrayReader(zip));
  try {
    const entries = await reader.getEntries();
    const entry =
      (offset !== null && entries.find((e) => e.offset === offset && !e.directory)) ||
      entries.find((e) => e.filename === name && !e.directory);
    if (!entry || entry.directory) throw new WorkshopError('broken', name);
    if (entry.uncompressedSize > MAX_EXTRACT_BYTES) throw new WorkshopError('too-big', name);
    try {
      return await entry.getData(new Uint8ArrayWriter(), { password });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A wrong ZipCrypto password usually shows up as a broken checksum.
      if (message === ERR_INVALID_PASSWORD || /password|signature/i.test(message)) {
        throw new WorkshopError('wrong-password', name);
      }
      throw new WorkshopError('broken', message);
    }
  } finally {
    await reader.close().catch(() => undefined);
  }
}
