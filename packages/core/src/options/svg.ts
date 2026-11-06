import type { EngineOption } from '../engine';

/**
 * SVG compression with svgo (browser and server use the same settings).
 * svgo itself is loaded by the engines; here are only the options and the
 * plain configuration object they hand to svgo's optimize().
 */

export const SVG_PRECISIONS = ['high', 'balanced', 'small'] as const;
export type SvgPrecision = (typeof SVG_PRECISIONS)[number];

/** Decimal places kept in coordinates. */
const DIGITS: Record<SvgPrecision, number> = { high: 5, balanced: 3, small: 1 };

export const SVG_OPTIONS: EngineOption[] = [
  {
    key: 'svgPrecision',
    labelKey: 'options.svgPrecision.label',
    helpKey: 'options.svgPrecision.help',
    effectKey: 'options.svgPrecision.effect',
    advanced: false,
    type: 'select',
    default: 'balanced',
    choices: SVG_PRECISIONS.map((value) => ({
      value,
      labelKey: `options.svgPrecision.${value}`,
    })),
    appliesTo: ['svg'],
  },
  {
    key: 'svgKeepEditorData',
    labelKey: 'options.svgKeepEditorData.label',
    helpKey: 'options.svgKeepEditorData.help',
    advanced: true,
    type: 'boolean',
    default: false,
    appliesTo: ['svg'],
  },
];

export function resolveSvgPrecision(raw: Record<string, unknown>): SvgPrecision {
  const v = raw['svgPrecision'];
  return v === 'high' || v === 'small' ? v : 'balanced';
}

/**
 * svgo configuration for the options. Several passes squeeze out a little
 * more; titles, descriptions and the viewBox stay (screen readers and
 * scaling need them – svgo 4 keeps them by default). "Keep editor data"
 * leaves Inkscape/Illustrator's layers and notes alone.
 */
export function svgoConfig(raw: Record<string, unknown>) {
  const keep = raw['svgKeepEditorData'] === true;
  return {
    multipass: true,
    floatPrecision: DIGITS[resolveSvgPrecision(raw)],
    plugins: [
      {
        name: 'preset-default' as const,
        params: {
          overrides: keep
            ? { removeEditorsNSData: false as const, removeMetadata: false as const }
            : {},
        },
      },
    ],
  };
}
