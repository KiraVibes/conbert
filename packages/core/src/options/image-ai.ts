import type { ModelFile } from '../models';

/**
 * AI tools for pictures on the server (ONNX Runtime): remove the background
 * (ISNet) and upscale (Real-ESRGAN). Both travel as plain options like the
 * cut of a video (trim.ts): `removeBackground: true`, `upscale: 2 | 4`.
 */

export const IMAGE_AI_MODELS = [
  {
    // ISNet / DIS "general use" (Apache-2.0), as published with rembg.
    id: 'isnet',
    file: 'isnet-general-use.onnx',
    bytes: 178_648_008,
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
  },
  {
    // Real-ESRGAN realesr-general-x4v3 (BSD-3-Clause), exported to ONNX with
    // flexible width and height (export script in the repository).
    id: 'realesr-general-x4v3',
    file: 'realesr-general-x4v3.onnx',
    bytes: 4_866_417,
    sha256: '1940a93ee08283a0a7286183186357b1688fe9fa8ede74604b424586aaddf112',
    url: 'https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/main/realesr-general-x4v3.onnx',
  },
] as const satisfies readonly ModelFile[];

export const BACKGROUND_MODEL = 'isnet';
export const UPSCALE_MODEL = 'realesr-general-x4v3';

/** Pictures the AI tools read (sharp on the server). */
export const IMAGE_AI_INPUTS = ['jpg', 'png', 'webp', 'avif', 'tiff', 'gif'];

/** Upscaled pictures may have at most this many pixels (8000 × 8000). */
export const MAX_UPSCALED_PIXELS = 64_000_000;

export const IMAGE_AI_KEYS = ['removeBackground', 'upscale'] as const;

export interface ImageAi {
  removeBackground: boolean;
  /** 1 = keep the size. */
  upscale: 1 | 2 | 4;
}

/** The AI work asked for, or null when there is none. */
export function readImageAi(options: Record<string, unknown>): ImageAi | null {
  const removeBackground = options['removeBackground'] === true;
  const raw = Number(options['upscale']);
  const upscale = raw === 2 || raw === 4 ? raw : 1;
  return removeBackground || upscale > 1 ? { removeBackground, upscale } : null;
}

/** Option values for the AI work; null removes them. */
export function imageAiOptions(ai: Partial<ImageAi>): Record<string, unknown> {
  return {
    removeBackground: ai.removeBackground === true || undefined,
    upscale: ai.upscale === 2 || ai.upscale === 4 ? ai.upscale : undefined,
  };
}

export function pickImageAiOptions(options: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of IMAGE_AI_KEYS) if (options[key] !== undefined) picked[key] = options[key];
  return picked;
}

export interface Tile {
  /** The part that is written to the result (input pixels). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The part that is fed to the model: the tile plus a margin (no seams). */
  inX: number;
  inY: number;
  inWidth: number;
  inHeight: number;
}

/** Splits a picture into tiles with an overlapping margin, row by row. */
export function imageTiles(width: number, height: number, size = 192, margin = 12): Tile[] {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      const w = Math.min(size, width - x);
      const h = Math.min(size, height - y);
      const inX = Math.max(0, x - margin);
      const inY = Math.max(0, y - margin);
      tiles.push({
        x,
        y,
        width: w,
        height: h,
        inX,
        inY,
        inWidth: Math.min(width, x + w + margin) - inX,
        inHeight: Math.min(height, y + h + margin) - inY,
      });
    }
  }
  return tiles;
}
