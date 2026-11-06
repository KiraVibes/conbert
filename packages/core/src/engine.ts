/**
 * The engine contract. Every converter – browser (WASM) or server (native
 * binary) – implements this interface. New formats are added only through
 * engines or format lists, never through special cases in the UI.
 */

export type Runtime = 'browser' | 'server';

export type Category =
  | 'image'
  | 'vector'
  | 'audio'
  | 'video'
  | 'document'
  | 'ebook'
  | 'pdf'
  | '3d'
  | 'archive'
  | 'font'
  | 'data'
  | 'midi';

export const CATEGORIES: readonly Category[] = [
  'image',
  'vector',
  'audio',
  'video',
  'document',
  'ebook',
  'pdf',
  '3d',
  'archive',
  'font',
  'data',
  'midi',
];

export interface FormatSupport {
  /** Without dot, lowercase: 'png', 'glb'. */
  ext: string;
  mime?: string;
  canRead: boolean;
  canWrite: boolean;
}

export interface EngineOptionChoice {
  value: string;
  labelKey: string;
  helpKey?: string;
}

export interface EngineOption {
  /** e.g. 'quality', 'bitrate', 'dpi'. */
  key: string;
  /** i18n key, e.g. 'options.quality.label'. */
  labelKey: string;
  /** Required: plain-language explanation (i18n key). */
  helpKey: string;
  /** What happens when the value goes up or down? (i18n key) */
  effectKey?: string;
  /** true = only visible in expert mode. */
  advanced: boolean;
  /**
   * 'file': a second file chosen next to the input (e.g. subtitles to burn
   * in). The value is the file itself in the browser; the server hands the
   * engine only a checked path, through `ConvertRequest.attachments`.
   */
  type: 'number' | 'select' | 'boolean' | 'string' | 'file';
  default: unknown;
  /** Only for 'file': the endings that can be chosen, e.g. ['srt', 'vtt', 'ass']. */
  accept?: string[];
  min?: number;
  max?: number;
  step?: number;
  choices?: EngineOptionChoice[];
  /** Output formats this option applies to. Missing = all. */
  appliesTo?: string[];
}

export interface ConvertProgress {
  /** 0–100. */
  percent: number;
  /** Optional stage id, rendered through i18n ('stages.<id>'). */
  stage?: string;
}

export interface ConvertRequest {
  /** Blob in the browser, file path on the server. */
  input: Blob | string;
  inputExt: string;
  outputExt: string;
  options: Record<string, unknown>;
  signal?: AbortSignal;
  onProgress?: (p: ConvertProgress) => void;
  /** Server only: folder for this job's files; engines write their output here. */
  workDir?: string;
  /**
   * Server only: files for options of type 'file', by option key – paths the
   * server has checked (own file, allowed ending). Never taken from `options`.
   */
  attachments?: Record<string, string>;
}

export type EngineStatus = 'uninitialized' | 'loading' | 'ready' | 'partial' | 'error';

export interface Engine {
  /** 'imagemagick', 'ffmpeg', 'libvips' … */
  id: string;
  name: string;
  /** Plain-language description (i18n key). */
  descriptionKey: string;
  category: Category;
  runtime: Runtime;
  formats: FormatSupport[];
  options: EngineOption[];
  supportsCompression: boolean;
  /**
   * Can cut a part out (options `trimStart`/`trimEnd`, see trim.ts) – also
   * into the same format. Audio and video engines only.
   */
  supportsTrim?: boolean;
  /** Higher = preferred when several engines can do the same thing. */
  priority: number;
  /** Lazy: load WASM / check binaries only when needed. */
  init(): Promise<void>;
  status(): EngineStatus;
  convert(req: ConvertRequest): Promise<Blob | string>;
}

/**
 * Serializable description of an engine (no functions). The server reports its
 * engines this way via GET /api/engines; the frontend builds "remote engines"
 * from it that convert through the server API.
 */
export type EngineDescriptor = Omit<Engine, 'init' | 'status' | 'convert'> & {
  status: EngineStatus;
};

export function describeEngine(engine: Engine): EngineDescriptor {
  return {
    id: engine.id,
    name: engine.name,
    descriptionKey: engine.descriptionKey,
    category: engine.category,
    runtime: engine.runtime,
    formats: engine.formats,
    options: engine.options,
    supportsCompression: engine.supportsCompression,
    ...(engine.supportsTrim && { supportsTrim: true }),
    priority: engine.priority,
    status: engine.status(),
  };
}

/** Options that apply to a given output format. */
export function optionsFor(options: readonly EngineOption[], outputExt: string): EngineOption[] {
  return options.filter((o) => !o.appliesTo || o.appliesTo.includes(outputExt));
}

/** Default option values for a given output format. */
export function defaultOptions(
  options: readonly EngineOption[],
  outputExt: string,
): Record<string, unknown> {
  return Object.fromEntries(optionsFor(options, outputExt).map((o) => [o.key, o.default]));
}

/** All i18n keys an engine references – used by the help-text tests. */
export function engineI18nKeys(engine: Pick<Engine, 'descriptionKey' | 'options'>): string[] {
  const keys = [engine.descriptionKey];
  for (const o of engine.options) {
    keys.push(o.labelKey, o.helpKey);
    if (o.effectKey) keys.push(o.effectKey);
    for (const c of o.choices ?? []) {
      keys.push(c.labelKey);
      if (c.helpKey) keys.push(c.helpKey);
    }
  }
  return keys;
}
