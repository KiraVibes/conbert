import type { EngineOption } from '../engine';

/**
 * Text recognition (OCR) for scanned PDFs with ocrmypdf + Tesseract on the
 * server: the pages keep their look, an invisible text layer makes them
 * searchable and copyable.
 */

export const OCR_LANGUAGES = ['deu+eng', 'deu', 'eng'] as const;
export type OcrLanguages = (typeof OCR_LANGUAGES)[number];
export const OCR_MODES = ['skip', 'redo', 'force'] as const;
export type OcrMode = (typeof OCR_MODES)[number];

export const OCR_OPTIONS: EngineOption[] = [
  {
    key: 'ocrLanguage',
    labelKey: 'options.ocrLanguage.label',
    helpKey: 'options.ocrLanguage.help',
    advanced: false,
    type: 'select',
    default: 'deu+eng',
    choices: OCR_LANGUAGES.map((value) => ({
      value,
      labelKey: `options.ocrLanguage.${value.replace('+', '_')}`,
    })),
    appliesTo: ['pdf'],
  },
  {
    key: 'ocrRotate',
    labelKey: 'options.ocrRotate.label',
    helpKey: 'options.ocrRotate.help',
    advanced: false,
    type: 'boolean',
    default: true,
    appliesTo: ['pdf'],
  },
  {
    key: 'ocrDeskew',
    labelKey: 'options.ocrDeskew.label',
    helpKey: 'options.ocrDeskew.help',
    effectKey: 'options.ocrDeskew.effect',
    advanced: true,
    type: 'boolean',
    default: false,
    appliesTo: ['pdf'],
  },
  {
    key: 'ocrMode',
    labelKey: 'options.ocrMode.label',
    helpKey: 'options.ocrMode.help',
    advanced: true,
    type: 'select',
    default: 'skip',
    choices: OCR_MODES.map((value) => ({
      value,
      labelKey: `options.ocrMode.${value}`,
      helpKey: `options.ocrMode.${value}Help`,
    })),
    appliesTo: ['pdf'],
  },
];

export interface OcrSettings {
  languages: OcrLanguages;
  mode: OcrMode;
  rotate: boolean;
  deskew: boolean;
}

/** Only known values ever reach the command line. */
export function resolveOcr(raw: Record<string, unknown>): OcrSettings {
  const language = raw['ocrLanguage'];
  const mode = raw['ocrMode'];
  return {
    languages: OCR_LANGUAGES.find((l) => l === language) ?? 'deu+eng',
    mode: OCR_MODES.find((m) => m === mode) ?? 'skip',
    rotate: raw['ocrRotate'] !== false,
    deskew: raw['ocrDeskew'] === true,
  };
}

/** Arguments for `ocrmypdf`. */
export function ocrmypdfArgs(
  input: string,
  output: string,
  settings: OcrSettings,
  jobs: number,
): string[] {
  const modeFlag = { skip: '--skip-text', redo: '--redo-ocr', force: '--force-ocr' }[settings.mode];
  return [
    modeFlag,
    '-l',
    settings.languages,
    // Plain PDF: no PDF/A conversion, which can change colours and takes long.
    '--output-type',
    'pdf',
    '--optimize',
    '1',
    '--jobs',
    String(Math.max(1, jobs)),
    ...(settings.rotate ? ['--rotate-pages'] : []),
    // ocrmypdf can't straighten pages while keeping their existing text.
    ...(settings.deskew && settings.mode !== 'redo' ? ['--deskew'] : []),
    '--',
    input,
    output,
  ];
}
