import type { EngineOption } from '../engine';

/** 3D options shared by the browser (three.js, gltf-transform) and the server (assimp, gltf-transform). */

export const MODEL_OPTIONS: EngineOption[] = [
  {
    key: 'modelBinary',
    labelKey: 'options.modelBinary.label',
    helpKey: 'options.modelBinary.help',
    advanced: true,
    type: 'boolean',
    default: true,
    appliesTo: ['stl', 'ply'],
  },
];

const GLTF = ['glb', 'gltf'];

/** Optimising glTF/GLB with gltf-transform (also used by the compress tab). */
export const GLTF_OPTIONS: EngineOption[] = [
  {
    key: 'meshCompression',
    labelKey: 'options.meshCompression.label',
    helpKey: 'options.meshCompression.help',
    effectKey: 'options.meshCompression.effect',
    advanced: false,
    type: 'select',
    // Off when just converting: not every 3D program reads compressed meshes.
    default: 'none',
    choices: [
      {
        value: 'none',
        labelKey: 'options.meshCompression.none',
        helpKey: 'options.meshCompression.noneHelp',
      },
      {
        value: 'meshopt',
        labelKey: 'options.meshCompression.meshopt',
        helpKey: 'options.meshCompression.meshoptHelp',
      },
      {
        value: 'draco',
        labelKey: 'options.meshCompression.draco',
        helpKey: 'options.meshCompression.dracoHelp',
      },
    ],
    appliesTo: GLTF,
  },
  {
    key: 'textureFormat',
    labelKey: 'options.textureFormat.label',
    helpKey: 'options.textureFormat.help',
    advanced: true,
    type: 'select',
    default: 'keep',
    choices: [
      { value: 'keep', labelKey: 'options.textureFormat.keep' },
      {
        value: 'webp',
        labelKey: 'options.textureFormat.webp',
        helpKey: 'options.textureFormat.webpHelp',
      },
    ],
    appliesTo: GLTF,
  },
  {
    key: 'textureSize',
    labelKey: 'options.textureSize.label',
    helpKey: 'options.textureSize.help',
    advanced: true,
    type: 'select',
    default: 'keep',
    choices: ['keep', '4096', '2048', '1024', '512'].map((value) => ({
      value,
      labelKey: `options.textureSize.s${value}`,
    })),
    appliesTo: GLTF,
  },
  {
    key: 'simplify',
    labelKey: 'options.simplify.label',
    helpKey: 'options.simplify.help',
    effectKey: 'options.simplify.effect',
    advanced: true,
    type: 'select',
    default: '1',
    choices: ['1', '0.75', '0.5', '0.25'].map((value) => ({
      value,
      labelKey: `options.simplify.r${value.replace('.', '')}`,
    })),
    appliesTo: GLTF,
  },
];

export interface GltfSettings {
  meshCompression: 'none' | 'meshopt' | 'draco';
  textureFormat: 'keep' | 'webp';
  /** Longest texture side in pixels, or null to keep. */
  textureSize: number | null;
  /** Share of triangles to keep (1 = all). */
  simplify: number;
}

/** Validates raw option values and fills in defaults. */
export function resolveGltfSettings(raw: Record<string, unknown>): GltfSettings {
  const mesh = raw['meshCompression'];
  const size = Number(raw['textureSize']);
  const ratio = Number(raw['simplify']);
  return {
    meshCompression: mesh === 'meshopt' || mesh === 'draco' ? mesh : 'none',
    textureFormat: raw['textureFormat'] === 'webp' ? 'webp' : 'keep',
    textureSize: [4096, 2048, 1024, 512].includes(size) ? size : null,
    simplify: [0.75, 0.5, 0.25].includes(ratio) ? ratio : 1,
  };
}
