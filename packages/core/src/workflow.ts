import type { Category } from './engine';
import { getFormat, normalizeExt } from './formats';
import { WORKFLOW_TRICKS } from './workshop/tricks';

/**
 * Workflows: a saved list of steps applied to files on the server
 * ("Herunterladen → in WebP umwandeln → komprimieren → auf NAS speichern").
 * A simple list, no node graph – easier to understand.
 */

export const EDIT_ACTIONS = ['resize', 'crop', 'rotate', 'strip-metadata', 'rename'] as const;
export type EditAction = (typeof EDIT_ACTIONS)[number];

/** Picture shapes for "Zuschneiden" (width:height). */
export const CROP_RATIOS = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
export type CropRatio = (typeof CROP_RATIOS)[number];
/** Which part stays: the middle, or the part a person would look at first. */
export const CROP_FOCUS = ['center', 'attention'] as const;
export type CropFocus = (typeof CROP_FOCUS)[number];

/**
 * The biggest box of the chosen shape that fits into the picture (whole
 * pixels). Null for an unknown shape.
 */
export function cropBox(
  width: number,
  height: number,
  ratio: string,
): { width: number; height: number } | null {
  const match = /^(\d+):(\d+)$/.exec(ratio);
  const w = Number(match?.[1]);
  const h = Number(match?.[2]);
  if (!match || !(w > 0) || !(h > 0) || width < 1 || height < 1) return null;
  if (width / height > w / h) {
    return { width: Math.max(1, Math.round((height * w) / h)), height };
  }
  return { width, height: Math.max(1, Math.round((width * h) / w)) };
}

export const WORKFLOW_COMPRESS_PRESETS = ['max', 'balanced', 'small'] as const;
export type WorkflowCompressPreset = (typeof WORKFLOW_COMPRESS_PRESETS)[number];

export interface FilterRule {
  category?: string[];
  ext?: string[];
  minWidth?: number;
  maxSizeMb?: number;
}

export type WorkflowStep =
  | { kind: 'convert'; outputExt: string; options: Record<string, unknown> }
  | { kind: 'compress'; preset: string; options?: Record<string, unknown> }
  | { kind: 'filter'; rule: FilterRule }
  | { kind: 'edit'; action: EditAction; params: Record<string, unknown> }
  /** Text recognition for PDFs (ocrmypdf, options from OCR_OPTIONS); other files go on unchanged. */
  | { kind: 'ocr'; options: Record<string, unknown> }
  | {
      kind: 'save';
      targetIds: string[];
      subfolderPattern?: string;
      /** Set by downloads: a folder named after the channel, profile or thread. */
      source?: string;
      /** Set by downloads: the platform's top folder ("Instagram", "4chan/g"). */
      platformFolder?: string;
      /** Set by downloads: a file already there with the same name and size is skipped. */
      sameFileSkips?: boolean;
    }
  /** FileWizard workshop trick (see WORKFLOW_TRICKS for the ones a workflow can run). */
  | { kind: 'workshop'; trick: string; params: Record<string, unknown> }
  | { kind: 'notify'; channelIds: string[] };

export type WorkflowStepKind = WorkflowStep['kind'];
/** Steps the editor offers. */
export const EDITOR_STEP_KINDS = [
  'filter',
  'convert',
  'compress',
  'edit',
  'ocr',
  'workshop',
  'save',
  'notify',
] as const;

export interface Workflow {
  id: string;
  name: string;
  descriptionKey?: string;
  steps: WorkflowStep[];
  /** Also keep (and save) the original file. */
  keepOriginal: boolean;
  /** Workflows always run on the server (subscriptions, downloads without an open browser). */
  runtime: 'server';
}

export const MAX_WORKFLOW_STEPS = 20;

/** What a filter looks at. */
export interface FilterSubject {
  ext: string;
  size: number;
  /** Only known for pictures (null = unknown). */
  width: number | null;
}

/** Does the file pass the filter? Missing conditions always pass. */
export function matchesFilter(rule: FilterRule, file: FilterSubject): boolean {
  const ext = normalizeExt(file.ext);
  if (rule.category && rule.category.length > 0) {
    const category = getFormat(ext)?.category;
    if (!category || !rule.category.includes(category)) return false;
  }
  if (rule.ext && rule.ext.length > 0 && !rule.ext.map(normalizeExt).includes(ext)) return false;
  if (rule.minWidth !== undefined && (file.width === null || file.width < rule.minWidth)) {
    return false;
  }
  if (rule.maxSizeMb !== undefined && file.size > rule.maxSizeMb * 1024 * 1024) return false;
  return true;
}

/** Whether the filter needs to know the picture's width. */
export const filterNeedsWidth = (rule: FilterRule) => rule.minWidth !== undefined;

/** New name for "rename": {name} (without extension), {date}, {counter}. */
export function renameWith(pattern: string, original: string, counter: number, date: Date): string {
  const base = original.replace(/\.[^.]+$/, '');
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const result = pattern
    .replace(/\{name\}/g, base)
    .replace(/\{date\}/g, day)
    .replace(/\{counter\}/g, String(counter).padStart(3, '0'))
    .replace(/[/\\]/g, '_')
    .trim();
  return result || base;
}

export interface WorkflowTemplate {
  id: string;
  nameKey: string;
  descriptionKey: string;
  steps: WorkflowStep[];
  keepOriginal: boolean;
}

/** Ready-made workflows to start from. */
export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: 'web',
    nameKey: 'workflows.templates.web.name',
    descriptionKey: 'workflows.templates.web.description',
    keepOriginal: false,
    steps: [
      { kind: 'filter', rule: { category: ['image'] } },
      { kind: 'edit', action: 'resize', params: { maxWidth: 1920, maxHeight: 1920 } },
      { kind: 'convert', outputExt: 'webp', options: { quality: 80 } },
      { kind: 'edit', action: 'strip-metadata', params: {} },
    ],
  },
  {
    id: 'photo-archive',
    nameKey: 'workflows.templates.photoArchive.name',
    descriptionKey: 'workflows.templates.photoArchive.description',
    keepOriginal: false,
    steps: [
      { kind: 'filter', rule: { category: ['image'] } },
      { kind: 'convert', outputExt: 'avif', options: { quality: 70 } },
    ],
  },
  {
    id: 'phone-video',
    nameKey: 'workflows.templates.phoneVideo.name',
    descriptionKey: 'workflows.templates.phoneVideo.description',
    keepOriginal: false,
    steps: [
      { kind: 'filter', rule: { category: ['video'] } },
      { kind: 'convert', outputExt: 'mp4', options: {} },
      { kind: 'compress', preset: 'balanced' },
    ],
  },
  {
    id: 'booru-nas',
    nameKey: 'workflows.templates.booruNas.name',
    descriptionKey: 'workflows.templates.booruNas.description',
    keepOriginal: false,
    steps: [
      { kind: 'filter', rule: { category: ['image'], ext: ['jpg', 'jpeg', 'png', 'bmp', 'tiff'] } },
      { kind: 'convert', outputExt: 'webp', options: { quality: 85 } },
      { kind: 'save', targetIds: [] },
    ],
  },
];

/** Categories a filter can choose from. */
export const FILTER_CATEGORIES: readonly Category[] = [
  'image',
  'video',
  'audio',
  'document',
  'pdf',
  '3d',
  'archive',
];

/** All i18n keys built from these lists – checked by a test. */
export function workflowI18nKeys(): string[] {
  return [
    ...EDITOR_STEP_KINDS.flatMap((k) => [
      `workflows.steps.${k}.title`,
      `workflows.steps.${k}.help`,
    ]),
    ...EDIT_ACTIONS.map((a) => `workflows.edit.${a}`),
    ...CROP_FOCUS.map((f) => `workflows.crop.${f}`),
    // ':' separates namespaces in i18next, so '16:9' is stored as '16x9'.
    ...CROP_RATIOS.map((r) => `workflows.crop.ratios.${r.replace(':', 'x')}`),
    ...WORKFLOW_TRICKS.flatMap((tr) => [
      `workflows.workshop.${tr}.title`,
      `workflows.workshop.${tr}.help`,
      `workflows.describe.tricks.${tr}`,
    ]),
    ...WORKFLOW_COMPRESS_PRESETS.map((p) => `workflows.compress.${p}`),
    ...WORKFLOW_TEMPLATES.flatMap((t) => [t.nameKey, t.descriptionKey]),
    ...FILTER_CATEGORIES.map((c) => `workflows.categories.${c}`),
  ];
}
