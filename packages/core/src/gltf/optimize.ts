import { WebIO, type Document, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import {
  dedup,
  draco,
  meshopt,
  prune,
  quantize,
  reorder,
  simplify,
  weld,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { ConversionError } from '../errors';
import type { GltfSettings } from '../options/model';

/**
 * glTF/GLB optimisation with gltf-transform – the same code in the browser
 * worker and on the server. Platform-specific parts are passed in: Draco
 * (Node only) and how pictures are re-encoded (sharp or OffscreenCanvas).
 */

/** Re-encodes one texture; returns null to keep it as it is. */
export type ImageEncoder = (
  image: Uint8Array,
  mimeType: string,
  target: { format: 'keep' | 'webp'; maxSize: number | null },
) => Promise<{ image: Uint8Array; mimeType: string } | null>;

export interface GltfPlatform {
  /** Draco modules (draco3dgltf); without them Draco is unavailable. */
  draco?: { encoder: unknown; decoder: unknown } | undefined;
  encodeImage?: ImageEncoder | undefined;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

async function createIo(platform: GltfPlatform): Promise<WebIO> {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
  if (platform.draco) {
    io.registerDependencies({
      'draco3d.encoder': platform.draco.encoder,
      'draco3d.decoder': platform.draco.decoder,
    });
  }
  return io;
}

/** Reads GLB or self-contained glTF (embedded data URIs). */
export async function readGltf(io: WebIO, data: Uint8Array, ext: string): Promise<Document> {
  try {
    if (ext === 'glb') return await io.readBinary(data);
    const json = JSON.parse(new TextDecoder().decode(data)) as Parameters<
      WebIO['readJSON']
    >[0]['json'];
    return await io.readJSON({ json, resources: {} });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Draco-compressed input in the browser: the server has the decoder.
    if (/draco/i.test(message)) throw new ConversionError('errors.formatUnavailable', message);
    throw new ConversionError('errors.convertFailed', message);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** GLB, or a single .gltf file with everything embedded as data URIs. */
export async function writeGltf(io: WebIO, doc: Document, ext: string): Promise<Uint8Array> {
  if (ext === 'glb') return io.writeBinary(doc);
  const { json, resources } = await io.writeJSON(doc);
  const embed = (uri: string | undefined, mime: string) => {
    const data = uri ? resources[uri] : undefined;
    return data ? `data:${mime};base64,${toBase64(data)}` : uri;
  };
  for (const buffer of json.buffers ?? []) {
    const uri = embed(buffer.uri, 'application/octet-stream');
    if (uri) buffer.uri = uri;
  }
  for (const image of json.images ?? []) {
    const uri = embed(image.uri, image.mimeType ?? 'image/png');
    if (uri) image.uri = uri;
  }
  return new TextEncoder().encode(JSON.stringify(json));
}

async function compressTextures(doc: Document, settings: GltfSettings, encode: ImageEncoder) {
  const textures: Texture[] = doc.getRoot().listTextures();
  for (const texture of textures) {
    const image = texture.getImage();
    const mime = texture.getMimeType();
    // KTX2 and other GPU formats are left alone.
    if (!image || !EXT_BY_MIME[mime]) continue;
    const result = await encode(image, mime, {
      format: settings.textureFormat,
      maxSize: settings.textureSize,
    });
    if (!result || result.image.length >= image.length) continue;
    texture.setImage(result.image).setMimeType(result.mimeType);
    const uri = texture.getURI();
    if (uri) texture.setURI(uri.replace(/\.[^.]+$/, `.${EXT_BY_MIME[result.mimeType] ?? 'bin'}`));
  }
  if (textures.some((t) => t.getMimeType() === 'image/webp')) {
    doc.createExtension(EXTTextureWebP).setRequired(true);
  }
}

/** Optimises a glTF/GLB: clean-up, optional simplification, textures, mesh compression. */
export async function optimizeGltf(
  input: Uint8Array,
  inputExt: string,
  outputExt: string,
  settings: GltfSettings,
  platform: GltfPlatform,
  onProgress: (percent: number) => void = () => undefined,
): Promise<Uint8Array> {
  if (settings.meshCompression === 'draco' && !platform.draco) {
    // Draco only runs on the server; the router tries the server next.
    throw new ConversionError('errors.formatUnavailable', 'draco needs the server');
  }
  const io = await createIo(platform);
  const doc = await readGltf(io, input, inputExt);
  onProgress(15);

  await doc.transform(dedup(), prune(), weld());
  if (settings.simplify < 1) {
    await MeshoptSimplifier.ready;
    await doc.transform(
      simplify({ simplifier: MeshoptSimplifier, ratio: settings.simplify, error: 0.01 }),
    );
  }
  onProgress(40);

  if (platform.encodeImage && (settings.textureFormat !== 'keep' || settings.textureSize)) {
    await compressTextures(doc, settings, platform.encodeImage);
  }
  onProgress(70);

  if (settings.meshCompression === 'meshopt') {
    await doc.transform(
      reorder({ encoder: MeshoptEncoder }),
      quantize(),
      meshopt({ encoder: MeshoptEncoder }),
    );
  } else if (settings.meshCompression === 'draco') {
    await doc.transform(draco({ method: 'edgebreaker' }));
  }
  onProgress(90);
  return writeGltf(io, doc, outputExt);
}
