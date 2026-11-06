import type { Category } from './engine';
import type { CompressLevel } from './compression';
import { getFormat, normalizeExt } from './formats';

/**
 * The "What do you need the file for?" assistant: a purpose picks the target
 * format and settings for each file. Every rule names a reason text that
 * explains in one sentence why exactly this was chosen.
 */

export const PURPOSES = [
  'messenger',
  'email',
  'web',
  'print',
  'phone',
  'print3d',
  'gameEngine',
  'saveSpace',
] as const;
export type PurposeId = (typeof PURPOSES)[number];

/** E-mail providers usually refuse attachments above 10 MB – aim a bit lower. */
export const EMAIL_TARGET_MB = 9.5;

export interface PurposeRule {
  /** Name of the rule – the reason text is `purposes.<purpose>.why.<id>`. */
  id: string;
  /** Candidate targets in order of preference; the first one that can be reached wins. */
  targets: readonly string[];
  options?: Record<string, unknown>;
  /** "compress" moves the file to the compress tab with these settings. */
  compress?: { level: CompressLevel; targetMb: number | null };
}

/** Rules per input category. A category without a rule doesn't fit the purpose. */
type RuleTable = Partial<Record<Category, PurposeRule>>;

const SAME = [] as const;

export const PURPOSE_RULES: Record<PurposeId, RuleTable> = {
  messenger: {
    image: { id: 'image', targets: ['jpg'], options: { quality: 80, stripMetadata: true } },
    video: {
      id: 'video',
      targets: ['mp4'],
      options: { videoQuality: 'balanced', resolution: '720' },
    },
    audio: { id: 'audio', targets: ['mp3'], options: { audioQuality: 'balanced' } },
    document: { id: 'document', targets: ['pdf'] },
    ebook: { id: 'document', targets: ['pdf'] },
  },
  email: {
    image: {
      id: 'image',
      targets: ['jpg'],
      compress: { level: 'target', targetMb: EMAIL_TARGET_MB },
    },
    video: {
      id: 'video',
      targets: ['mp4'],
      compress: { level: 'target', targetMb: EMAIL_TARGET_MB },
    },
    audio: {
      id: 'audio',
      targets: ['mp3'],
      compress: { level: 'target', targetMb: EMAIL_TARGET_MB },
    },
    pdf: { id: 'pdf', targets: SAME, compress: { level: 'small', targetMb: null } },
    document: { id: 'document', targets: ['pdf'] },
    ebook: { id: 'document', targets: ['pdf'] },
  },
  web: {
    image: { id: 'image', targets: ['webp'], options: { quality: 80, stripMetadata: true } },
    video: {
      id: 'video',
      targets: ['mp4'],
      options: { videoQuality: 'balanced', resolution: '1080' },
    },
    audio: { id: 'audio', targets: ['mp3'], options: { audioQuality: 'balanced' } },
    document: { id: 'document', targets: ['html'] },
    font: { id: 'font', targets: ['woff2'] },
    '3d': { id: 'model', targets: ['glb'], options: { meshCompression: 'meshopt' } },
  },
  print: {
    image: { id: 'image', targets: ['pdf', 'jpg'], options: { quality: 95 } },
    vector: { id: 'vector', targets: ['pdf'] },
    document: { id: 'document', targets: ['pdf'] },
    ebook: { id: 'document', targets: ['pdf'] },
    data: { id: 'document', targets: ['pdf'] },
  },
  phone: {
    image: { id: 'image', targets: ['jpg'], options: { quality: 90 } },
    video: { id: 'video', targets: ['mp4'], options: { videoQuality: 'high', videoCodec: 'auto' } },
    audio: { id: 'audio', targets: ['m4a', 'mp3'], options: { audioQuality: 'high' } },
    ebook: { id: 'ebook', targets: ['epub'] },
  },
  print3d: {
    '3d': { id: 'model', targets: ['stl', '3mf'], options: { modelBinary: true } },
  },
  gameEngine: {
    '3d': {
      id: 'model',
      targets: ['glb'],
      options: { meshCompression: 'meshopt', textureSize: '2048' },
    },
  },
  saveSpace: {
    image: { id: 'all', targets: SAME, compress: { level: 'balanced', targetMb: null } },
    video: { id: 'all', targets: SAME, compress: { level: 'balanced', targetMb: null } },
    audio: { id: 'all', targets: SAME, compress: { level: 'balanced', targetMb: null } },
    pdf: { id: 'all', targets: SAME, compress: { level: 'balanced', targetMb: null } },
    '3d': { id: 'all', targets: SAME, compress: { level: 'balanced', targetMb: null } },
    font: { id: 'all', targets: SAME, compress: { level: 'balanced', targetMb: null } },
    archive: { id: 'all', targets: SAME, compress: { level: 'balanced', targetMb: null } },
  },
};

export interface PurposeChoice {
  purpose: PurposeId;
  /** Chosen target, or null = keep the format (compress tab picks it). */
  targetExt: string | null;
  options: Record<string, unknown>;
  compress?: { level: CompressLevel; targetMb: number | null };
  /** i18n key: why this was chosen. */
  reasonKey: string;
}

export type PurposeResult =
  | { kind: 'choice'; choice: PurposeChoice }
  /** The file already has the right format for this purpose. */
  | { kind: 'alreadyFine'; reasonKey: string }
  /** This purpose doesn't fit the file (e.g. 3D printing for a song). */
  | { kind: 'notApplicable' };

/**
 * What a purpose means for a file. `canReach(ext)` tells whether the file can
 * be converted to `ext` with the engines at hand.
 */
export function choosePurpose(
  purpose: PurposeId,
  inputExt: string,
  canReach: (ext: string) => boolean,
): PurposeResult {
  const ext = normalizeExt(inputExt);
  const category = getFormat(ext)?.category;
  const rule = category ? PURPOSE_RULES[purpose][category] : undefined;
  if (!rule) return { kind: 'notApplicable' };
  const reasonKey = `purposes.${purpose}.why.${rule.id}`;

  if (rule.targets.length === 0) {
    return {
      kind: 'choice',
      choice: {
        purpose,
        targetExt: null,
        options: {},
        ...(rule.compress && { compress: rule.compress }),
        reasonKey,
      },
    };
  }
  // Already in the wanted format: nothing to convert (compressing still helps).
  if (rule.targets.includes(ext) && !rule.compress) {
    return { kind: 'alreadyFine', reasonKey };
  }
  const target = rule.targets.find((t) => t === ext || canReach(t));
  if (!target) return { kind: 'notApplicable' };
  return {
    kind: 'choice',
    choice: {
      purpose,
      targetExt: target,
      options: { ...rule.options },
      ...(rule.compress && { compress: rule.compress }),
      reasonKey,
    },
  };
}

/** All i18n keys of the assistant (for the locale completeness test). */
export function purposeI18nKeys(): string[] {
  return PURPOSES.flatMap((p) => [
    `purposes.${p}.label`,
    `purposes.${p}.summary`,
    ...[...new Set(Object.values(PURPOSE_RULES[p]).map((r) => r.id))].map(
      (id) => `purposes.${p}.why.${id}`,
    ),
  ]);
}
