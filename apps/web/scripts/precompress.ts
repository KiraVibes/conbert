import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { Plugin, ResolvedConfig } from 'vite';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/** Text and WASM shrink a lot; images, videos and fonts are compressed already. */
const COMPRESSIBLE = /\.(js|mjs|css|html|json|svg|wasm|map|txt|md|webmanifest|sf2|data)$/i;
const MIN_SIZE = 1024;
/** Above this, Brotli's best level takes minutes – a slightly lower level is nearly as small. */
const BIG = 4 * 1024 * 1024;

async function* files(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

/** Writes .br and .gz next to a file, but only when they save at least 10 %. */
export async function precompressFile(file: string): Promise<number> {
  const data = await readFile(file);
  const quality = data.length > BIG ? 9 : constants.BROTLI_MAX_QUALITY;
  const [br, gzipped] = await Promise.all([
    brotli(data, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: quality,
        [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
      },
    }),
    gz(data, { level: 9 }),
  ]);
  let saved = 0;
  if (br.length < data.length * 0.9) {
    await writeFile(`${file}.br`, br);
    saved = data.length - br.length;
  }
  if (gzipped.length < data.length * 0.9) await writeFile(`${file}.gz`, gzipped);
  return saved;
}

/**
 * Pre-compresses the build (Brotli + gzip) so the server can send the small
 * version without compressing on every request (@fastify/static preCompressed).
 */
export function precompress(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'conbert-precompress',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      const outDir = path.resolve(config.root, config.build.outDir);
      const todo: string[] = [];
      for await (const file of files(outDir)) {
        if (COMPRESSIBLE.test(file) && (await stat(file)).size >= MIN_SIZE) todo.push(file);
      }
      // A few at a time: the big WASM files need a lot of memory each.
      let saved = 0;
      for (let i = 0; i < todo.length; i += 4) {
        const sizes = await Promise.all(todo.slice(i, i + 4).map(precompressFile));
        saved += sizes.reduce((a, b) => a + b, 0);
      }
      config.logger.info(
        `precompressed ${todo.length} files, Brotli saves ${Math.round(saved / 1024 / 1024)} MB`,
      );
    },
  };
}
