import type * as LibArchive from 'libarchive.js';
import { ConversionError, getFormat } from '@conbert/core';
import { createMainThreadEngine } from './main-thread-engine';

/**
 * Archives in the browser with libarchive.js (libarchive compiled to
 * WebAssembly, running in its own worker): opens ZIP, 7Z, RAR, TAR and
 * TAR.GZ. Writing: TAR.GZ with libarchive, ZIP with fflate, TAR = TAR.GZ
 * unpacked again. (libarchive.js 2.0.2 writes empty files without a
 * compression filter, so 7Z is left to the server.)
 */
const WORKER_URL = '/wasm/libarchive/worker-bundle.js';
const READ = ['zip', '7z', 'rar', 'tar', 'tgz'];
const WRITE = ['zip', 'tar', 'tgz'];
/** Browsers keep everything in memory – lower limits than the server. */
const MAX_ENTRIES = 10_000;
const MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024;

type Lib = typeof LibArchive;
let lib: Lib | null = null;

interface Entry {
  file: { name: string; size: number; extract(): Promise<File> };
  path: string;
}

export const archivesBrowserEngine = createMainThreadEngine({
  meta: {
    id: 'archives-wasm',
    name: 'libarchive (Browser)',
    descriptionKey: 'engines.archivesWasm.description',
    category: 'archive',
    runtime: 'browser',
    formats: [...new Set([...READ, ...WRITE])].map((ext) => ({
      ext,
      canRead: READ.includes(ext),
      canWrite: WRITE.includes(ext),
    })),
    options: [],
    supportsCompression: false,
    priority: 10,
  },
  async load() {
    lib = await import('libarchive.js');
    lib.Archive.init({ workerUrl: new URL(WORKER_URL, window.location.origin) });
  },
  async run(input, inputExt, outputExt, _options, onProgress) {
    if (!lib) throw new ConversionError('errors.engineLoadFailed');
    const { Archive, ArchiveCompression, ArchiveFormat } = lib;
    const reader = await Archive.open(new File([input], `input.${inputExt}`));
    try {
      if (await reader.hasEncryptedData()) throw new ConversionError('errors.encrypted');
      const entries = (await reader.getFilesArray()) as Entry[];
      const bytes = entries.reduce((sum, e) => sum + e.file.size, 0);
      if (entries.length > MAX_ENTRIES || bytes > MAX_UNPACKED_BYTES) {
        throw new ConversionError(
          'errors.archiveTooLarge',
          `${entries.length} entries, ${bytes} bytes`,
        );
      }
      onProgress(20, 'converting');
      const files: { file: File; pathname: string }[] = [];
      for (const [index, entry] of entries.entries()) {
        const file = await entry.file.extract();
        files.push({ file, pathname: `${entry.path}${entry.file.name}` });
        onProgress(20 + Math.round((index / Math.max(1, entries.length)) * 50), 'converting');
      }
      if (files.length === 0) throw new ConversionError('errors.convertFailed', 'empty archive');
      const type = getFormat(outputExt)?.mime ?? 'application/octet-stream';
      if (outputExt === 'zip') {
        const { zip } = await import('fflate');
        const entriesForZip: Record<string, Uint8Array> = {};
        for (const f of files)
          entriesForZip[f.pathname] = new Uint8Array(await f.file.arrayBuffer());
        const zipped = await new Promise<Uint8Array>((resolve, reject) =>
          zip(entriesForZip, { level: 6 }, (error, data) =>
            error ? reject(error) : resolve(data),
          ),
        );
        return new Blob([zipped as Uint8Array<ArrayBuffer>], { type });
      }
      const gz = await Archive.write({
        files: files as unknown as Parameters<typeof Archive.write>[0]['files'],
        outputFileName: `output.${outputExt}`,
        compression: ArchiveCompression.GZIP,
        format: ArchiveFormat.PAX,
        passphrase: null,
      });
      if (outputExt === 'tgz') return new Blob([gz], { type });
      const { gunzipSync } = await import('fflate');
      const tar = gunzipSync(new Uint8Array(await gz.arrayBuffer()));
      return new Blob([tar as Uint8Array<ArrayBuffer>], { type });
    } finally {
      await reader.close().catch(() => undefined);
    }
  },
});
