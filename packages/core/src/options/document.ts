import type { EngineOption } from '../engine';

/**
 * pandoc formats and options, shared by the server engine (native pandoc)
 * and the browser engine (pandoc-wasm).
 */

/** pandoc reader per input format. Plain text is read as Markdown. */
export const PANDOC_READERS: Record<string, string> = {
  md: 'markdown',
  txt: 'markdown',
  html: 'html',
  docx: 'docx',
  odt: 'odt',
  rtf: 'rtf',
  rst: 'rst',
  tex: 'latex',
  org: 'org',
  epub: 'epub',
};

/** pandoc writer per output format. */
export const PANDOC_WRITERS: Record<string, string> = {
  md: 'gfm',
  txt: 'plain',
  html: 'html5',
  docx: 'docx',
  odt: 'odt',
  rtf: 'rtf',
  rst: 'rst',
  tex: 'latex',
  org: 'org',
  epub: 'epub3',
};

/** Writers that produce a complete document only with --standalone. */
const STANDALONE = new Set(['html', 'rtf', 'tex', 'epub', 'docx', 'odt']);
const TOC_TARGETS = ['html', 'docx', 'odt', 'epub', 'tex'];

export const DOCUMENT_OPTIONS: EngineOption[] = [
  {
    key: 'tableOfContents',
    labelKey: 'options.tableOfContents.label',
    helpKey: 'options.tableOfContents.help',
    advanced: true,
    type: 'boolean',
    default: false,
    appliesTo: TOC_TARGETS,
  },
  {
    key: 'markdownFlavor',
    labelKey: 'options.markdownFlavor.label',
    helpKey: 'options.markdownFlavor.help',
    advanced: true,
    type: 'select',
    default: 'gfm',
    choices: [
      {
        value: 'gfm',
        labelKey: 'options.markdownFlavor.gfm',
        helpKey: 'options.markdownFlavor.gfmHelp',
      },
      {
        value: 'commonmark',
        labelKey: 'options.markdownFlavor.commonmark',
        helpKey: 'options.markdownFlavor.commonmarkHelp',
      },
      {
        value: 'markdown',
        labelKey: 'options.markdownFlavor.markdown',
        helpKey: 'options.markdownFlavor.markdownHelp',
      },
    ],
    appliesTo: ['md'],
  },
  {
    key: 'epubTitlePage',
    labelKey: 'options.epubTitlePage.label',
    helpKey: 'options.epubTitlePage.help',
    advanced: true,
    type: 'boolean',
    default: true,
    appliesTo: ['epub'],
  },
];

/**
 * Fallback metadata goes into this file next to the input. pandoc reads it
 * with --metadata-file, so the document's own title wins over it.
 */
export const PANDOC_METADATA_FILE = 'conbert-metadata.yaml';

/** What pandoc should do for one conversion – turned into CLI args or pandoc-wasm options. */
export interface PandocSettings {
  reader: string;
  writer: string;
  standalone: boolean;
  /** Used only where the document has no value of its own (e.g. its title). */
  fallbackMetadata: Record<string, string>;
  /** false = EPUB without the extra first page showing the title. */
  epubTitlePage: boolean;
  tableOfContents: boolean;
  wrapNone: boolean;
}

export function pandocSettings(
  inputExt: string,
  outputExt: string,
  options: Record<string, unknown>,
  title: string,
): PandocSettings {
  const reader = PANDOC_READERS[inputExt];
  let writer = PANDOC_WRITERS[outputExt];
  if (!reader || !writer) throw new Error(`pandoc: .${inputExt} → .${outputExt} not supported`);
  if (outputExt === 'md') {
    const flavor = options['markdownFlavor'];
    if (flavor === 'commonmark' || flavor === 'markdown') writer = flavor;
  }
  const fallbackMetadata: Record<string, string> = {};
  // A title avoids warnings and gives HTML/EPUB a proper name – but only if
  // the document has none (e.g. the title set in Word's file properties).
  if (outputExt === 'html') fallbackMetadata['pagetitle'] = title;
  if (outputExt === 'epub') fallbackMetadata['title'] = title;
  return {
    reader,
    writer,
    standalone: STANDALONE.has(outputExt),
    fallbackMetadata,
    epubTitlePage: outputExt !== 'epub' || options['epubTitlePage'] !== false,
    tableOfContents: options['tableOfContents'] === true && TOC_TARGETS.includes(outputExt),
    wrapNone: ['txt', 'md', 'rst', 'org'].includes(outputExt),
  };
}

/** Metadata values are read as Markdown: escape punctuation so a file name stays literal. */
function yamlText(value: string): string {
  return JSON.stringify(value.replace(/[!-/:-@[-`{-~]/g, '\\$&'));
}

/**
 * Content of {@link PANDOC_METADATA_FILE} for one conversion, or null when
 * none is needed. JSON is valid YAML.
 */
export function pandocMetadataYaml(
  inputExt: string,
  outputExt: string,
  options: Record<string, unknown>,
  title: string,
): string | null {
  const { fallbackMetadata } = pandocSettings(inputExt, outputExt, options, title);
  const entries = Object.entries(fallbackMetadata);
  if (entries.length === 0) return null;
  return entries.map(([key, value]) => `${key}: ${yamlText(value)}`).join('\n') + '\n';
}

/**
 * pandoc arguments for one conversion (without input/output paths).
 * `--sandbox` keeps documents from reading other files or URLs
 * (e.g. LaTeX \input or images in HTML).
 */
export function pandocArgs(
  inputExt: string,
  outputExt: string,
  options: Record<string, unknown>,
  title: string,
): string[] {
  const s = pandocSettings(inputExt, outputExt, options, title);
  const args = ['--sandbox', '-f', s.reader, '-t', s.writer];
  if (s.standalone) args.push('--standalone');
  if (Object.keys(s.fallbackMetadata).length > 0)
    args.push('--metadata-file', PANDOC_METADATA_FILE);
  if (!s.epubTitlePage) args.push('--epub-title-page=false');
  if (s.tableOfContents) args.push('--toc');
  if (s.wrapNone) args.push('--wrap=none');
  return args;
}

/**
 * The same settings as pandoc-wasm options (pandoc's defaults-file keys).
 * pandoc-wasm is sandboxed by design: it only sees the files it is given.
 */
export function pandocWasmOptions(
  inputExt: string,
  outputExt: string,
  options: Record<string, unknown>,
  title: string,
): Record<string, unknown> {
  const s = pandocSettings(inputExt, outputExt, options, title);
  return {
    from: s.reader,
    to: s.writer,
    standalone: s.standalone,
    ...(Object.keys(s.fallbackMetadata).length > 0 && { 'metadata-files': [PANDOC_METADATA_FILE] }),
    ...(!s.epubTitlePage && { 'epub-title-page': false }),
    ...(s.tableOfContents && { 'table-of-contents': true }),
    ...(s.wrapNone && { wrap: 'none' }),
  };
}
