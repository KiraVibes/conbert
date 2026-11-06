import type { EngineOption } from '../engine';

/**
 * Video → Game Boy Advance module (.gba). A GBA cartridge holds at most
 * 32 MB, so picture size, frame rate and sound decide how long a video fits.
 */

/** Largest ROM a GBA (and every flash cart) can address: 32 MiB. */
export const GBA_MAX_ROM_BYTES = 32 * 1024 * 1024;

export type GbaQuality = 'sharp' | 'balanced' | 'long';

export interface GbaProfile {
  /** Picture stored in the module; the GBA scales it up to its 240 × 160 screen. */
  width: number;
  height: number;
  /** How much a 8×8 block may differ before it is redrawn (mean squared RGB distance). */
  blockThreshold: number;
  /** Sound sample rate: 16 777 216 Hz (GBA clock) / timer steps. */
  audioTimerSteps: number;
}

export const GBA_PROFILES: Record<GbaQuality, GbaProfile> = {
  // Full resolution, 1:1.
  sharp: { width: 240, height: 160, blockThreshold: 48, audioTimerSteps: 1024 },
  // Scaled by 1.5 (240 × 156 on screen).
  balanced: { width: 160, height: 104, blockThreshold: 96, audioTimerSteps: 1024 },
  // Scaled by 2.
  long: { width: 120, height: 80, blockThreshold: 160, audioTimerSteps: 1280 },
};

export const GBA_OPTIONS: EngineOption[] = [
  {
    key: 'gbaQuality',
    labelKey: 'options.gbaQuality.label',
    helpKey: 'options.gbaQuality.help',
    effectKey: 'options.gbaQuality.effect',
    advanced: false,
    type: 'select',
    default: 'balanced',
    choices: (['sharp', 'balanced', 'long'] as const).map((value) => ({
      value,
      labelKey: `options.gbaQuality.${value}`,
      helpKey: `options.gbaQuality.${value}Help`,
    })),
    appliesTo: ['gba'],
  },
  {
    key: 'gbaFps',
    labelKey: 'options.gbaFps.label',
    helpKey: 'options.gbaFps.help',
    effectKey: 'options.gbaFps.effect',
    advanced: true,
    type: 'select',
    default: '15',
    choices: ['20', '15', '12', '10'].map((value) => ({
      value,
      labelKey: `options.gbaFps.f${value}`,
    })),
    appliesTo: ['gba'],
  },
  {
    key: 'gbaLoop',
    labelKey: 'options.gbaLoop.label',
    helpKey: 'options.gbaLoop.help',
    advanced: false,
    type: 'boolean',
    default: false,
    appliesTo: ['gba'],
  },
  {
    key: 'removeAudio',
    labelKey: 'options.removeAudio.label',
    helpKey: 'options.gbaSound.help',
    advanced: true,
    type: 'boolean',
    default: false,
    appliesTo: ['gba'],
  },
];

export interface GbaSettings extends GbaProfile {
  quality: GbaQuality;
  fps: number;
  withAudio: boolean;
  /** Start in endless playback (SELECT on the GBA toggles it). */
  loop: boolean;
  /** Sample rate in Hz (rounded; the GBA timer runs at 16 777 216 / steps). */
  audioRate: number;
}

/** Validates raw option values and fills in defaults. */
export function resolveGbaSettings(raw: Record<string, unknown>): GbaSettings {
  const q = raw['gbaQuality'];
  const quality: GbaQuality = q === 'sharp' || q === 'long' ? q : 'balanced';
  const fps = Number(raw['gbaFps']);
  const profile = GBA_PROFILES[quality];
  return {
    ...profile,
    quality,
    fps: [10, 12, 15, 20].includes(fps) ? fps : 15,
    withAudio: raw['removeAudio'] !== true,
    loop: raw['gbaLoop'] === true,
    audioRate: Math.round(16_777_216 / profile.audioTimerSteps),
  };
}
