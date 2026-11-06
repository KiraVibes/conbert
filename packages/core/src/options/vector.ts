import type { EngineOption } from '../engine';

/**
 * Options for raster → SVG tracing (vtracer), shared by the server and a
 * later browser build.
 *
 * The simple "detail" level sets every tracing value at once. In expert mode
 * each value can be set on its own ("Automatic" = follow the detail level).
 */

/** Detail levels, from the finest to the coarsest. */
const DETAIL_LEVELS = ['max', 'high', 'balanced', 'small', 'min'] as const;
type DetailLevel = (typeof DETAIL_LEVELS)[number];

/** One step on a fine ↔ coarse scale; "auto" follows the detail level. */
const SCALE = ['finest', 'fine', 'medium', 'coarse', 'coarsest'] as const;
type ScaleStep = (typeof SCALE)[number];

/**
 * vtracer values per scale step (finest → coarsest). The detail levels use
 * the step at the same position: "max" = finest everywhere, and so on.
 */
const VALUES = {
  /** --filter_speckle: patches smaller than this many pixels are dropped. */
  speckle: [0, 2, 4, 10, 24],
  /** --color_precision: significant bits per color channel (1–8). */
  colorPrecision: [8, 7, 6, 4, 2],
  /** --gradient_step: color difference between layers (smaller = more layers). */
  gradientStep: [1, 8, 16, 32, 64],
  /** --corner_threshold: smallest angle (°) that counts as a corner. */
  cornerThreshold: [15, 40, 60, 90, 130],
  /** --segment_length: length of curve pieces (vtracer allows 3.5–10). */
  segmentLength: [3.5, 3.75, 4, 6, 10],
  /** --splice_threshold: smallest angle change (°) that starts a new curve. */
  spliceThreshold: [15, 30, 45, 60, 90],
  /** --path_precision: decimal places in the SVG coordinates. */
  pathPrecision: [8, 6, 4, 3, 2],
} as const;
type TracingValue = keyof typeof VALUES;

/** Tracing resolution: longest side, and whether small images are enlarged first. */
const TRACE_SIZES = {
  fast: { maxSide: 1024, enlarge: false },
  normal: { maxSide: 2048, enlarge: false },
  fine: { maxSide: 2048, enlarge: true },
  max: { maxSide: 4096, enlarge: true },
} as const;
type TraceSize = keyof typeof TRACE_SIZES;

const scaleOption = (key: string): EngineOption => ({
  key,
  labelKey: `options.${key}.label`,
  helpKey: `options.${key}.help`,
  effectKey: `options.${key}.effect`,
  advanced: true,
  type: 'select',
  default: 'auto',
  choices: ['auto', ...SCALE].map((step, index) => ({
    value: step,
    labelKey: `options.vectorScale.${step}`,
    // e.g. "4 Pixel" – the real vtracer value, for people who know it.
    ...(index > 0 && { helpKey: `options.${key}.v${index - 1}` }),
  })),
  appliesTo: ['svg'],
});

/** Expert options that override one tracing value each. */
const SCALE_OPTIONS: Record<TracingValue, string> = {
  speckle: 'vectorSpeckle',
  colorPrecision: 'vectorColorPrecision',
  gradientStep: 'vectorGradientStep',
  cornerThreshold: 'vectorCorners',
  segmentLength: 'vectorSegmentLength',
  spliceThreshold: 'vectorSplice',
  pathPrecision: 'vectorPathPrecision',
};

export const VECTOR_OPTIONS: EngineOption[] = [
  {
    key: 'colorMode',
    labelKey: 'options.colorMode.label',
    helpKey: 'options.colorMode.help',
    advanced: false,
    type: 'select',
    default: 'color',
    choices: [
      {
        value: 'color',
        labelKey: 'options.colorMode.color',
        helpKey: 'options.colorMode.colorHelp',
      },
      { value: 'bw', labelKey: 'options.colorMode.bw', helpKey: 'options.colorMode.bwHelp' },
    ],
    appliesTo: ['svg'],
  },
  {
    key: 'vectorDetail',
    labelKey: 'options.vectorDetail.label',
    helpKey: 'options.vectorDetail.help',
    effectKey: 'options.vectorDetail.effect',
    advanced: false,
    type: 'select',
    default: 'balanced',
    choices: DETAIL_LEVELS.map((level) => ({
      value: level,
      labelKey: `options.vectorDetail.${level}`,
      helpKey: `options.vectorDetail.${level}Help`,
    })),
    appliesTo: ['svg'],
  },
  {
    key: 'vectorTraceSize',
    labelKey: 'options.vectorTraceSize.label',
    helpKey: 'options.vectorTraceSize.help',
    effectKey: 'options.vectorTraceSize.effect',
    advanced: false,
    type: 'select',
    default: 'normal',
    choices: (Object.keys(TRACE_SIZES) as TraceSize[]).map((size) => ({
      value: size,
      labelKey: `options.vectorTraceSize.${size}`,
      helpKey: `options.vectorTraceSize.${size}Help`,
    })),
    appliesTo: ['svg'],
  },
  {
    key: 'curveMode',
    labelKey: 'options.curveMode.label',
    helpKey: 'options.curveMode.help',
    advanced: true,
    type: 'select',
    default: 'spline',
    choices: [
      {
        value: 'spline',
        labelKey: 'options.curveMode.spline',
        helpKey: 'options.curveMode.splineHelp',
      },
      {
        value: 'polygon',
        labelKey: 'options.curveMode.polygon',
        helpKey: 'options.curveMode.polygonHelp',
      },
      { value: 'none', labelKey: 'options.curveMode.none', helpKey: 'options.curveMode.noneHelp' },
    ],
    appliesTo: ['svg'],
  },
  {
    key: 'vectorLayers',
    labelKey: 'options.vectorLayers.label',
    helpKey: 'options.vectorLayers.help',
    advanced: true,
    type: 'select',
    default: 'stacked',
    choices: [
      {
        value: 'stacked',
        labelKey: 'options.vectorLayers.stacked',
        helpKey: 'options.vectorLayers.stackedHelp',
      },
      {
        value: 'cutout',
        labelKey: 'options.vectorLayers.cutout',
        helpKey: 'options.vectorLayers.cutoutHelp',
      },
    ],
    appliesTo: ['svg'],
  },
  ...Object.values(SCALE_OPTIONS).map(scaleOption),
];

export interface VectorOptions {
  colorMode: 'color' | 'bw';
  detail: DetailLevel;
  curveMode: 'spline' | 'polygon' | 'none';
  layers: 'stacked' | 'cutout';
  /** Longest side for tracing; small images are enlarged up to it when `enlarge` is set. */
  traceSize: { maxSide: number; enlarge: boolean };
  values: Record<TracingValue, number>;
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

export function resolveVectorOptions(raw: Record<string, unknown>): VectorOptions {
  const detail = pick(raw['vectorDetail'], DETAIL_LEVELS, 'balanced');
  const level = DETAIL_LEVELS.indexOf(detail);
  const values = {} as Record<TracingValue, number>;
  for (const [value, key] of Object.entries(SCALE_OPTIONS) as [TracingValue, string][]) {
    const step = pick<ScaleStep | 'auto'>(raw[key], ['auto', ...SCALE], 'auto');
    const scale: readonly number[] = VALUES[value];
    values[value] = scale[step === 'auto' ? level : SCALE.indexOf(step)] ?? scale[2] ?? 0;
  }
  return {
    colorMode: raw['colorMode'] === 'bw' ? 'bw' : 'color',
    detail,
    curveMode: pick(raw['curveMode'], ['spline', 'polygon', 'none'], 'spline'),
    layers: pick(raw['vectorLayers'], ['stacked', 'cutout'], 'stacked'),
    traceSize:
      TRACE_SIZES[pick(raw['vectorTraceSize'], Object.keys(TRACE_SIZES) as TraceSize[], 'normal')],
    values,
  };
}

/** vtracer command-line flags for the chosen options. */
export function vtracerArgs(o: VectorOptions): string[] {
  const v = o.values;
  return [
    '--colormode',
    o.colorMode,
    '--hierarchical',
    o.layers,
    '--mode',
    o.curveMode,
    '--filter_speckle',
    String(v.speckle),
    '--color_precision',
    String(v.colorPrecision),
    '--gradient_step',
    String(v.gradientStep),
    '--corner_threshold',
    String(v.cornerThreshold),
    '--segment_length',
    String(v.segmentLength),
    '--splice_threshold',
    String(v.spliceThreshold),
    '--path_precision',
    String(v.pathPrecision),
  ];
}

/** The real vtracer values behind each scale step, e.g. for help texts and tests. */
export const VECTOR_SCALE_VALUES = VALUES;
