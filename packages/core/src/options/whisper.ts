import type { EngineOption } from '../engine';
import type { ModelFile } from '../models';

/**
 * Speech to text (Whisper, whisper.cpp on the server). The models are not
 * part of the image: the server downloads the chosen one on first use and
 * checks it against the size and SHA-256 Hugging Face publishes for it.
 */

/** A Whisper model (file name in the whisper.cpp model repository). */
export type WhisperModel = ModelFile;

export const WHISPER_MODELS = [
  {
    id: 'base',
    file: 'ggml-base-q5_1.bin',
    bytes: 59_707_625,
    sha256: '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898',
  },
  {
    id: 'small',
    file: 'ggml-small-q5_1.bin',
    bytes: 190_085_487,
    sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
  },
  {
    id: 'large-v3-turbo',
    file: 'ggml-large-v3-turbo-q5_0.bin',
    bytes: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
  },
] as const satisfies readonly WhisperModel[];

export type WhisperModelId = (typeof WHISPER_MODELS)[number]['id'];
export const DEFAULT_WHISPER_MODEL: WhisperModelId = 'small';
export const WHISPER_MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

export function whisperModel(id: unknown): WhisperModel | undefined {
  return WHISPER_MODELS.find((m) => m.id === id);
}

/** Output formats of a transcription. */
export const TRANSCRIPT_FORMATS = ['srt', 'vtt', 'txt'] as const;

export const WHISPER_LANGUAGES = [
  'auto',
  'de',
  'en',
  'fr',
  'es',
  'it',
  'nl',
  'pl',
  'pt',
  'tr',
  'ru',
  'uk',
  'ar',
  'ja',
  'zh',
] as const;
export type WhisperLanguage = (typeof WHISPER_LANGUAGES)[number];

export const WHISPER_OPTIONS: EngineOption[] = [
  {
    key: 'speechLanguage',
    labelKey: 'options.speechLanguage.label',
    helpKey: 'options.speechLanguage.help',
    advanced: false,
    type: 'select',
    default: 'auto',
    choices: WHISPER_LANGUAGES.map((value) => ({
      value,
      labelKey: `options.speechLanguage.${value}`,
    })),
    appliesTo: [...TRANSCRIPT_FORMATS],
  },
  {
    key: 'translateToEnglish',
    labelKey: 'options.translateToEnglish.label',
    helpKey: 'options.translateToEnglish.help',
    advanced: true,
    type: 'boolean',
    default: false,
    appliesTo: [...TRANSCRIPT_FORMATS],
  },
];

export interface WhisperSettings {
  language: WhisperLanguage;
  translate: boolean;
}

export function resolveWhisper(raw: Record<string, unknown>): WhisperSettings {
  return {
    language: WHISPER_LANGUAGES.find((l) => l === raw['speechLanguage']) ?? 'auto',
    translate: raw['translateToEnglish'] === true,
  };
}

const OUTPUT_FLAG: Record<(typeof TRANSCRIPT_FORMATS)[number], string> = {
  srt: '--output-srt',
  vtt: '--output-vtt',
  txt: '--output-txt',
};

/**
 * Arguments for `whisper-cli`. The input must be 16 kHz mono WAV; the result
 * lands next to `outputBase` as `<outputBase>.<ext>`.
 */
export function whisperArgs(req: {
  model: string;
  input: string;
  outputBase: string;
  outputExt: (typeof TRANSCRIPT_FORMATS)[number];
  settings: WhisperSettings;
  threads: number;
}): string[] {
  return [
    '--model',
    req.model,
    '--file',
    req.input,
    '--language',
    req.settings.language,
    ...(req.settings.translate ? ['--translate'] : []),
    '--threads',
    String(Math.max(1, req.threads)),
    OUTPUT_FLAG[req.outputExt],
    '--output-file',
    req.outputBase,
    // Progress on stderr ("progress = 45%"), no text dump on stdout.
    '--print-progress',
    '--no-prints',
  ];
}

/** Last "progress = 45%" in a chunk of whisper-cli output. */
export function parseWhisperProgress(chunk: string): number | null {
  const matches = [...chunk.matchAll(/progress\s*=\s*(\d+)\s*%/g)];
  const last = matches.at(-1)?.[1];
  return last === undefined ? null : Math.min(100, Number(last));
}
