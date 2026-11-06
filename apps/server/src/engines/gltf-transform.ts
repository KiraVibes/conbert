import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  ConversionError,
  GLTF_OPTIONS,
  abortError,
  getFormat,
  normalizeExt,
  resolveGltfSettings,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import { optimizeGltf, type GltfPlatform, type ImageEncoder } from '@conbert/core/gltf';

/** draco3dgltf is CommonJS and loads its WebAssembly from its own folder. */
const require = createRequire(import.meta.url);
interface Draco3d {
  createEncoderModule(): Promise<unknown>;
  createDecoderModule(): Promise<unknown>;
}

let status: EngineStatus = 'uninitialized';
let platform: Promise<GltfPlatform> | null = null;

/** Textures with sharp: shrink to the size limit, optionally as WebP. */
const encodeImage: ImageEncoder = async (image, mimeType, target) => {
  let pipeline = sharp(image, { failOn: 'error' });
  if (target.maxSize) {
    pipeline = pipeline.resize(target.maxSize, target.maxSize, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  if (target.format === 'webp') {
    return {
      image: new Uint8Array(await pipeline.webp({ quality: 85 }).toBuffer()),
      mimeType: 'image/webp',
    };
  }
  if (!target.maxSize) return null;
  const same =
    mimeType === 'image/jpeg' ? pipeline.jpeg({ quality: 88, mozjpeg: true }) : pipeline.png();
  return { image: new Uint8Array(await same.toBuffer()), mimeType };
};

function loadPlatform(): Promise<GltfPlatform> {
  platform ??= (async () => {
    const draco = require('draco3dgltf') as Draco3d;
    const [encoder, decoder] = await Promise.all([
      draco.createEncoderModule(),
      draco.createDecoderModule(),
    ]);
    return { draco: { encoder, decoder }, encodeImage };
  })();
  return platform;
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError(
      'errors.convertFailed',
      'gltf-transform needs a file path and workDir',
    );
  }
  const from = normalizeExt(req.inputExt);
  const to = normalizeExt(req.outputExt);
  await mkdir(req.workDir, { recursive: true });
  const output = path.join(req.workDir, `${randomUUID()}.${to}`);
  const result = await optimizeGltf(
    new Uint8Array(await readFile(req.input)),
    from,
    to,
    resolveGltfSettings(req.options),
    await loadPlatform(),
    (percent) => req.onProgress?.({ percent, stage: 'converting' }),
  );
  if (req.signal?.aborted) throw abortError();
  await writeFile(output, result);
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

const GLTF = ['glb', 'gltf'];

export const gltfTransformServerEngine: Engine = {
  id: 'gltf-transform',
  name: 'glTF-Transform',
  descriptionKey: 'engines.gltfTransform.description',
  category: '3d',
  runtime: 'server',
  formats: GLTF.map((ext) => ({
    ext,
    mime: getFormat(ext)?.mime ?? '',
    canRead: true,
    canWrite: true,
  })),
  options: GLTF_OPTIONS,
  supportsCompression: true,
  // Preferred for glTF ↔ GLB: lossless and keeps everything glTF can express.
  priority: 20,
  async init() {
    try {
      await loadPlatform();
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
