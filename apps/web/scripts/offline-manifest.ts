import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Written next to index.html; the service worker reads it (public/sw.js). */
export const OFFLINE_MANIFEST = 'offline-manifest.json';

/** Never kept for offline use: the worker itself, the manifest and source maps. */
const SKIP = new Set(['sw.js', OFFLINE_MANIFEST]);

export interface OfflineFile {
  url: string;
  /** Short content hash: a file is downloaded again only when it changed. */
  hash: string;
  size: number;
}

export interface OfflineManifest {
  version: string;
  files: OfflineFile[];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Lists every file of the build with a content hash. */
export function buildOfflineManifest(outDir: string): OfflineManifest {
  const files = walk(outDir)
    .map((full) => ({ full, rel: path.relative(outDir, full).split(path.sep).join('/') }))
    // .br/.gz are only other encodings of the same file; the browser picks them itself.
    .filter(
      ({ rel }) =>
        !SKIP.has(rel) && !/\.(map|br|gz)$/.test(rel) && !rel.startsWith('.vite/'),
    )
    .map(({ full, rel }) => ({
      url: `/${rel}`,
      hash: createHash('sha256').update(readFileSync(full)).digest('hex').slice(0, 16),
      size: statSync(full).size,
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
  const version = createHash('sha256')
    .update(files.map((f) => `${f.url}:${f.hash}`).join('\n'))
    .digest('hex')
    .slice(0, 16);
  return { version, files };
}

/** Vite plugin: writes offline-manifest.json after the build. */
export function offlineManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'conbert-offline-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const manifest = buildOfflineManifest(outDir);
      writeFileSync(path.join(outDir, OFFLINE_MANIFEST), JSON.stringify(manifest));
    },
  };
}
