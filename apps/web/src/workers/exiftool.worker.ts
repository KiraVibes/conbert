import * as Comlink from 'comlink';

/**
 * ExifTool (Perl compiled to WebAssembly) in its own worker: reads and writes
 * metadata without the file ever leaving the device. The 25 MB runtime is
 * served by Conbert itself (/wasm/exiftool) and only loaded when needed.
 */
const WASM_URL = new URL('/wasm/exiftool/zeroperl.wasm', self.location.origin).href;
const fetchWasm = () => fetch(WASM_URL);

// zeroperl tells "browser" from "Node" by window and document, which a worker
// doesn't have – it would then try to read the WASM from disk. In this worker
// (and only here) both names point to harmless stand-ins.
const scope = self as unknown as Record<string, unknown>;
scope['window'] ??= self;
scope['document'] ??= {};
const exiftool = import('@uswriting/exiftool');

const api = {
  /** All tags as "Group:Tag" → value (ExifTool -json -G1 -a). */
  async read(blob: Blob, ext: string): Promise<Record<string, unknown>> {
    const { parseMetadata } = await exiftool;
    const result = await parseMetadata(
      { name: `file.${ext}`, data: blob },
      {
        args: ['-json', '-G1', '-a'],
        fetch: fetchWasm,
        transform: (data) => JSON.parse(data) as Record<string, unknown>[],
      },
    );
    if (!result.success) throw new Error(result.error);
    return result.data[0] ?? {};
  },

  /** The same file with new metadata. */
  async write(
    blob: Blob,
    ext: string,
    tags: Record<string, string | string[]>,
    args: string[],
  ): Promise<Uint8Array> {
    const { writeMetadata } = await exiftool;
    const result = await writeMetadata({ name: `file.${ext}`, data: blob }, tags, {
      args,
      fetch: fetchWasm,
    });
    if (!result.success) throw new Error(result.error);
    const bytes = new Uint8Array(result.data);
    return Comlink.transfer(bytes, [bytes.buffer]);
  },
};

export type ExiftoolWorkerApi = typeof api;
Comlink.expose(api);
