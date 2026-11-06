import type { PandocInstance } from 'pandoc-wasm/core';
import {
  ConversionError,
  PANDOC_METADATA_FILE,
  PANDOC_READERS,
  PANDOC_WRITERS,
  normalizeExt,
  pandocMetadataYaml,
  pandocWasmOptions,
} from '@conbert/core';

type Progress = (percent: number, stage?: string) => void;

/** One conversion with pandoc-wasm. Same settings as the server's native pandoc. */
export async function convertWithPandocWasm(
  pandoc: PandocInstance,
  input: Uint8Array,
  inputExt: string,
  outputExt: string,
  options: Record<string, unknown>,
  onProgress: Progress,
): Promise<Uint8Array> {
  const from = normalizeExt(inputExt);
  const to = normalizeExt(outputExt);
  if (!PANDOC_READERS[from] || !PANDOC_WRITERS[to]) {
    throw new ConversionError('errors.formatUnavailable', `pandoc-wasm: .${from} → .${to}`);
  }
  const inName = `input.${from}`;
  const outName = `output.${to}`;
  // The file name is only a fallback: the document's own title wins.
  const title = typeof options['title'] === 'string' ? options['title'] : 'Dokument';
  const metadata = pandocMetadataYaml(from, to, options, title);
  onProgress(10, 'converting');
  const result = await pandoc.convert(
    {
      ...pandocWasmOptions(from, to, options, title),
      'input-files': [inName],
      'output-file': outName,
    },
    null,
    {
      [inName]: new Blob([input as Uint8Array<ArrayBuffer>]),
      ...(metadata && { [PANDOC_METADATA_FILE]: new Blob([metadata]) }),
    },
  );
  const output = result.files[outName];
  if (!output) {
    const details = result.stderr.trim() || 'pandoc produced no output';
    throw new ConversionError('errors.convertFailed', details);
  }
  onProgress(100, 'done');
  return new Uint8Array(await output.arrayBuffer());
}
