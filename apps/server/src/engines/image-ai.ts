import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  BACKGROUND_MODEL,
  ConversionError,
  IMAGE_AI_INPUTS,
  MAX_UPSCALED_PIXELS,
  UPSCALE_MODEL,
  abortError,
  getFormat,
  imageTiles,
  readImageAi,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import type * as OrtModule from 'onnxruntime-node';
import type { InferenceSession } from 'onnxruntime-node';
import type { ModelStore } from '../models/model-store';

/**
 * AI for pictures with ONNX Runtime on the CPU: remove the background
 * (ISNet) and upscale (Real-ESRGAN). The models are downloaded on first use.
 * The engine is never picked by the router – the server puts it in front of
 * a job when the options ask for it (routes/jobs.ts).
 */

type Ort = typeof OrtModule;

let status: EngineStatus = 'uninitialized';
let store: ModelStore | null = null;
const sessions = new Map<string, Promise<InferenceSession>>();
const THREADS = Math.max(1, Math.min(4, os.availableParallelism()));

/** Set at startup (app.ts): where the models live. */
export function configureImageAi(models: ModelStore): void {
  store = models;
}

export function imageAiModels(): ModelStore {
  if (!store) throw new ConversionError('errors.imageAiFailed', 'image AI is not configured');
  return store;
}

async function loadOrt(): Promise<Ort> {
  return import('onnxruntime-node');
}

async function session(
  id: string,
  req: ConvertRequest,
  from: number,
  to: number,
): Promise<InferenceSession> {
  let open = sessions.get(id);
  if (!open) {
    const file = await imageAiModels().ensure(
      id,
      (received, total) =>
        req.onProgress?.({
          percent: from + Math.round((received / total) * (to - from)),
          stage: 'downloadingModel',
        }),
      req.signal,
    );
    const ort = await loadOrt();
    open = ort.InferenceSession.create(file, {
      executionProviders: ['cpu'],
      intraOpNumThreads: THREADS,
      graphOptimizationLevel: 'all',
    });
    sessions.set(id, open);
    open.catch(() => sessions.delete(id));
  }
  return open;
}

/** RGB pixels → float NCHW in 0…1. */
function toTensorData(rgb: Buffer, width: number, height: number, scale = 1, shift = 0) {
  const plane = width * height;
  const data = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    data[i] = ((rgb[i * 3] ?? 0) / 255) * scale - shift;
    data[plane + i] = ((rgb[i * 3 + 1] ?? 0) / 255) * scale - shift;
    data[2 * plane + i] = ((rgb[i * 3 + 2] ?? 0) / 255) * scale - shift;
  }
  return data;
}

/** Background mask (0 = background … 255 = subject) in the picture's size. */
async function backgroundMask(
  rgb: Buffer,
  width: number,
  height: number,
  req: ConvertRequest,
): Promise<Buffer> {
  const model = await session(BACKGROUND_MODEL, req, 2, 40);
  req.onProgress?.({ percent: 42, stage: 'removingBackground' });
  const size = 1024;
  const small = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  // ISNet expects 0…1 divided by the brightest value, minus 0.5.
  let max = 1;
  for (const v of small) if (v > max) max = v;
  const ort = await loadOrt();
  const input = new ort.Tensor('float32', toTensorData(small, size, size, 255 / max, 0.5), [
    1,
    3,
    size,
    size,
  ]);
  const name = model.inputNames[0] ?? 'input';
  const output = await model.run({ [name]: input });
  const first = output[model.outputNames[0] ?? ''];
  if (!first) throw new ConversionError('errors.imageAiFailed', 'ISNet gave no mask');
  const pred = first.data as Float32Array;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < size * size; i++) {
    const v = pred[i] ?? 0;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1;
  const mask = Buffer.alloc(size * size);
  for (let i = 0; i < size * size; i++) mask[i] = Math.round((((pred[i] ?? 0) - lo) / range) * 255);
  return (
    sharp(mask, { raw: { width: size, height: size, channels: 1 } })
      .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
      // Sharp would hand back three colour channels otherwise.
      .extractChannel(0)
      .raw()
      .toBuffer()
  );
}

/** Four times bigger with Real-ESRGAN, tile by tile (any picture size, little memory). */
async function upscale4(
  rgb: Buffer,
  width: number,
  height: number,
  req: ConvertRequest,
  from: number,
): Promise<Buffer> {
  const model = await session(UPSCALE_MODEL, req, from, from + 5);
  const ort = await loadOrt();
  const outWidth = width * 4;
  const out = Buffer.alloc(outWidth * height * 4 * 3);
  const tiles = imageTiles(width, height);
  for (const [n, tile] of tiles.entries()) {
    if (req.signal?.aborted) throw abortError();
    const crop = Buffer.alloc(tile.inWidth * tile.inHeight * 3);
    for (let y = 0; y < tile.inHeight; y++) {
      const start = ((tile.inY + y) * width + tile.inX) * 3;
      rgb.copy(crop, y * tile.inWidth * 3, start, start + tile.inWidth * 3);
    }
    const input = new ort.Tensor('float32', toTensorData(crop, tile.inWidth, tile.inHeight), [
      1,
      3,
      tile.inHeight,
      tile.inWidth,
    ]);
    const result = await model.run({ [model.inputNames[0] ?? 'input']: input });
    const data = result[model.outputNames[0] ?? '']?.data as Float32Array | undefined;
    if (!data) throw new ConversionError('errors.imageAiFailed', 'Real-ESRGAN gave no picture');
    const tw = tile.inWidth * 4;
    const plane = tw * tile.inHeight * 4;
    // Copy only the tile itself (without its margin) into the result.
    const offX = (tile.x - tile.inX) * 4;
    const offY = (tile.y - tile.inY) * 4;
    for (let y = 0; y < tile.height * 4; y++) {
      for (let x = 0; x < tile.width * 4; x++) {
        const src = (offY + y) * tw + offX + x;
        const dst = ((tile.y * 4 + y) * outWidth + tile.x * 4 + x) * 3;
        for (let c = 0; c < 3; c++) {
          const v = data[c * plane + src] ?? 0;
          out[dst + c] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
        }
      }
    }
    req.onProgress?.({
      percent: from + 5 + Math.round(((n + 1) / tiles.length) * (95 - from - 5)),
      stage: 'upscaling',
    });
  }
  return out;
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.imageAiFailed', 'image AI needs a file path and workDir');
  }
  const ai = readImageAi(req.options);
  if (!ai) throw new ConversionError('errors.imageAiFailed', 'no AI work asked for');
  await mkdir(req.workDir, { recursive: true });

  // The picture as it is shown (EXIF turned), first frame of a GIF.
  let image;
  try {
    image = await sharp(req.input, { failOn: 'none', animated: false })
      .rotate()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new ConversionError(
      'errors.convertFailed',
      error instanceof Error ? error.message : String(error),
    );
  }
  let { width, height } = image.info;
  const pixels = width * height;
  let rgb: Buffer = Buffer.alloc(pixels * 3);
  let alpha: Buffer = Buffer.alloc(pixels);
  for (let i = 0; i < pixels; i++) {
    rgb[i * 3] = image.data[i * 4] ?? 0;
    rgb[i * 3 + 1] = image.data[i * 4 + 1] ?? 0;
    rgb[i * 3 + 2] = image.data[i * 4 + 2] ?? 0;
    alpha[i] = image.data[i * 4 + 3] ?? 255;
  }
  if (ai.upscale > 1 && pixels * ai.upscale * ai.upscale > MAX_UPSCALED_PIXELS) {
    throw new ConversionError(
      'errors.imageTooLargeToUpscale',
      `${width}×${height} × ${ai.upscale}`,
    );
  }

  try {
    if (ai.removeBackground) {
      const mask = await backgroundMask(rgb, width, height, req);
      // A picture that was already partly transparent stays so.
      for (let i = 0; i < pixels; i++) alpha[i] = Math.min(alpha[i] ?? 255, mask[i] ?? 0);
    }
    if (ai.upscale > 1) {
      const from = ai.removeBackground ? 50 : 2;
      let big = await upscale4(rgb, width, height, req, from);
      let bigWidth = width * 4;
      let bigHeight = height * 4;
      if (ai.upscale === 2) {
        // ×2: the model always makes ×4; a good downscale keeps the detail.
        big = await sharp(big, { raw: { width: bigWidth, height: bigHeight, channels: 3 } })
          .resize(width * 2, height * 2, { kernel: 'lanczos3' })
          .raw()
          .toBuffer();
        bigWidth = width * 2;
        bigHeight = height * 2;
      }
      alpha = await sharp(alpha, { raw: { width, height, channels: 1 } })
        .resize(bigWidth, bigHeight, { fit: 'fill', kernel: 'lanczos3' })
        .extractChannel(0)
        .raw()
        .toBuffer();
      rgb = big;
      width = bigWidth;
      height = bigHeight;
    }
  } catch (error) {
    if (req.signal?.aborted) throw abortError();
    if (error instanceof ConversionError) throw error;
    throw new ConversionError(
      'errors.imageAiFailed',
      error instanceof Error ? error.message : String(error),
    );
  }

  req.onProgress?.({ percent: 97, stage: 'writing' });
  const output = path.join(req.workDir, `${randomUUID()}.png`);
  await sharp(rgb, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png({ compressionLevel: 6 })
    .toFile(output);
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const imageAiEngine: Engine = {
  id: 'image-ai',
  name: 'ONNX Runtime (ISNet, Real-ESRGAN)',
  descriptionKey: 'engines.imageAi.description',
  category: 'image',
  runtime: 'server',
  // Only reads: the router must never pick it for a normal conversion.
  formats: IMAGE_AI_INPUTS.map((ext) => ({
    ext,
    mime: getFormat(ext)?.mime ?? '',
    canRead: true,
    canWrite: false,
  })),
  options: [],
  supportsCompression: false,
  priority: 1,
  async init() {
    try {
      await loadOrt();
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
