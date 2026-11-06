/** The environment-independent core of pandoc-wasm (aliased in vite.config.ts). */
declare module 'pandoc-wasm/core' {
  export interface PandocResult {
    stdout: string;
    stderr: string;
    warnings: unknown[];
    files: Record<string, Blob>;
    mediaFiles: Record<string, Blob>;
  }
  export interface PandocInstance {
    convert(
      options: Record<string, unknown>,
      stdin: string | null,
      files: Record<string, Blob | string>,
    ): Promise<PandocResult>;
  }
  export function createPandocInstance(wasm: ArrayBuffer | Uint8Array): Promise<PandocInstance>;
}
