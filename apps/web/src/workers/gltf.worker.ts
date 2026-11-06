import { resolveGltfSettings } from '@conbert/core';
import { optimizeGltf, type ImageEncoder } from '@conbert/core/gltf';
import { exposeEngine } from './expose-engine';

/** Textures with the browser's own encoder (OffscreenCanvas). */
const encodeImage: ImageEncoder = async (image, mimeType, target) => {
  const bitmap = await createImageBitmap(
    new Blob([image as Uint8Array<ArrayBuffer>], { type: mimeType }),
  );
  const scale = target.maxSize
    ? Math.min(1, target.maxSize / Math.max(bitmap.width, bitmap.height))
    : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const type = target.format === 'webp' ? 'image/webp' : mimeType;
  const blob = await canvas.convertToBlob({ type, quality: 0.85 });
  // Browsers without a WebP encoder fall back to PNG – then keep the original.
  if (blob.type !== type) return null;
  return { image: new Uint8Array(await blob.arrayBuffer()), mimeType: type };
};

exposeEngine({
  init: () => Promise.resolve({ unavailableFormats: [] }),
  convert: (input, inputExt, outputExt, options, onProgress) =>
    optimizeGltf(input, inputExt, outputExt, resolveGltfSettings(options), { encodeImage }, (p) =>
      onProgress(p, 'converting'),
    ),
});
