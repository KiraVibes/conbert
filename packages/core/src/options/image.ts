import type { EngineOption } from '../engine';

/**
 * Options shared by all image engines (libvips in the browser, sharp and
 * ImageMagick on the server), so the same choices and help texts apply
 * wherever a picture is converted.
 */

export const LOSSY_IMAGE_TARGETS = ['jpg', 'webp', 'avif', 'jxl'];

export const IMAGE_OPTIONS: EngineOption[] = [
  {
    key: 'quality',
    labelKey: 'options.quality.label',
    helpKey: 'options.quality.help',
    effectKey: 'options.quality.effect',
    advanced: false,
    type: 'number',
    default: 80,
    min: 1,
    max: 100,
    step: 1,
    appliesTo: LOSSY_IMAGE_TARGETS,
  },
  {
    key: 'lossless',
    labelKey: 'options.lossless.label',
    helpKey: 'options.lossless.help',
    effectKey: 'options.lossless.effect',
    advanced: true,
    type: 'boolean',
    default: false,
    appliesTo: ['webp', 'avif', 'jxl'],
  },
  {
    key: 'effort',
    labelKey: 'options.effort.label',
    helpKey: 'options.effort.help',
    advanced: true,
    type: 'select',
    default: 'balanced',
    choices: [
      { value: 'fast', labelKey: 'options.effort.fast', helpKey: 'options.effort.fastHelp' },
      {
        value: 'balanced',
        labelKey: 'options.effort.balanced',
        helpKey: 'options.effort.balancedHelp',
      },
      { value: 'small', labelKey: 'options.effort.small', helpKey: 'options.effort.smallHelp' },
    ],
    appliesTo: ['webp', 'avif', 'jxl', 'png', 'gif'],
  },
  {
    key: 'stripMetadata',
    labelKey: 'options.stripMetadata.label',
    helpKey: 'options.stripMetadata.help',
    effectKey: 'options.stripMetadata.effect',
    advanced: true,
    type: 'boolean',
    default: true,
  },
  {
    key: 'keepAnimation',
    labelKey: 'options.keepAnimation.label',
    helpKey: 'options.keepAnimation.help',
    advanced: true,
    type: 'boolean',
    default: true,
    appliesTo: ['gif', 'webp'],
  },
  {
    key: 'pngPalette',
    labelKey: 'options.pngPalette.label',
    helpKey: 'options.pngPalette.help',
    effectKey: 'options.pngPalette.effect',
    advanced: true,
    type: 'boolean',
    default: false,
    appliesTo: ['png'],
  },
  {
    key: 'tiffCompression',
    labelKey: 'options.tiffCompression.label',
    helpKey: 'options.tiffCompression.help',
    advanced: true,
    type: 'select',
    default: 'deflate',
    choices: [
      { value: 'deflate', labelKey: 'options.tiffCompression.deflate' },
      { value: 'lzw', labelKey: 'options.tiffCompression.lzw' },
      {
        value: 'jpeg',
        labelKey: 'options.tiffCompression.jpeg',
        helpKey: 'options.tiffCompression.jpegHelp',
      },
      { value: 'none', labelKey: 'options.tiffCompression.none' },
    ],
    appliesTo: ['tiff'],
  },
];

export interface ImageOptions {
  quality: number;
  lossless: boolean;
  effort: 'fast' | 'balanced' | 'small';
  stripMetadata: boolean;
  keepAnimation: boolean;
  pngPalette: boolean;
  tiffCompression: 'deflate' | 'lzw' | 'jpeg' | 'none';
  /**
   * Internal (compressing to a size): width and height in percent of the
   * original, 100 = unchanged. Not shown as an option.
   */
  scalePercent: number;
}

const DEFAULTS: ImageOptions = {
  quality: 80,
  lossless: false,
  effort: 'balanced',
  stripMetadata: true,
  keepAnimation: true,
  pngPalette: false,
  tiffCompression: 'deflate',
  scalePercent: 100,
};

/** Validates raw option values from the UI and fills in defaults. */
export function resolveImageOptions(raw: Record<string, unknown>): ImageOptions {
  const pick = <K extends keyof ImageOptions>(key: K, ok: (v: unknown) => boolean) =>
    (ok(raw[key]) ? raw[key] : DEFAULTS[key]) as ImageOptions[K];
  const isBool = (v: unknown) => typeof v === 'boolean';
  const quality = Number(raw['quality']);
  const scale = Number(raw['scalePercent']);
  return {
    quality: Number.isFinite(quality) ? Math.min(100, Math.max(1, Math.round(quality))) : 80,
    lossless: pick('lossless', isBool),
    effort: pick('effort', (v) => v === 'fast' || v === 'balanced' || v === 'small'),
    stripMetadata: pick('stripMetadata', isBool),
    keepAnimation: pick('keepAnimation', isBool),
    pngPalette: pick('pngPalette', isBool),
    tiffCompression: pick('tiffCompression', (v) =>
      ['deflate', 'lzw', 'jpeg', 'none'].includes(String(v)),
    ),
    scalePercent: Number.isFinite(scale) && scale > 0 && scale < 100 ? Math.max(1, scale) : 100,
  };
}

/** Encoder effort per format for "fast / balanced / small". */
export const IMAGE_EFFORT: Record<string, Record<ImageOptions['effort'], number>> = {
  webp: { fast: 1, balanced: 4, small: 6 },
  avif: { fast: 2, balanced: 4, small: 7 },
  jxl: { fast: 3, balanced: 7, small: 9 },
  png: { fast: 3, balanced: 7, small: 10 },
  gif: { fast: 3, balanced: 7, small: 10 },
};
