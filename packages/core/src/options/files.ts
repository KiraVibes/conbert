import type { EngineOption } from '../engine';

/** Options for fonts, archives and data formats. */

export const FONT_OPTIONS: EngineOption[] = [
  {
    key: 'fontSubset',
    labelKey: 'options.fontSubset.label',
    helpKey: 'options.fontSubset.help',
    effectKey: 'options.fontSubset.effect',
    advanced: true,
    type: 'select',
    default: 'all',
    choices: (['all', 'latin-ext', 'latin'] as const).map((value) => ({
      value,
      labelKey: `options.fontSubset.${value}`,
      helpKey: `options.fontSubset.${value}Help`,
    })),
    appliesTo: ['ttf', 'otf', 'woff', 'woff2'],
  },
];

export type FontSubset = 'all' | 'latin' | 'latin-ext';

export function resolveFontSubset(raw: Record<string, unknown>): FontSubset {
  const v = raw['fontSubset'];
  return v === 'latin' || v === 'latin-ext' ? v : 'all';
}

/** Unicode ranges per subset (pyftsubset --unicodes syntax). */
export const FONT_SUBSET_UNICODES: Record<Exclude<FontSubset, 'all'>, string> = {
  // Basic Latin, Latin-1 (umlauts, ß, €-adjacent signs), general punctuation, €.
  latin: 'U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-203A,U+20AC,U+2122',
  'latin-ext':
    'U+0020-007E,U+00A0-024F,U+0300-036F,U+1E00-1EFF,U+2010-2027,U+2030-203A,U+20A0-20CF,U+2122',
};

export const ARCHIVE_OPTIONS: EngineOption[] = [
  {
    key: 'archiveLevel',
    labelKey: 'options.archiveLevel.label',
    helpKey: 'options.archiveLevel.help',
    effectKey: 'options.archiveLevel.effect',
    advanced: false,
    type: 'select',
    default: 'normal',
    choices: (['store', 'normal', 'max'] as const).map((value) => ({
      value,
      labelKey: `options.archiveLevel.${value}`,
      helpKey: `options.archiveLevel.${value}Help`,
    })),
    appliesTo: ['zip', '7z', 'tgz'],
  },
];

export type ArchiveLevel = 'store' | 'normal' | 'max';

export function resolveArchiveLevel(raw: Record<string, unknown>): ArchiveLevel {
  const v = raw['archiveLevel'];
  return v === 'store' || v === 'max' ? v : 'normal';
}

export const ARCHIVE_LEVEL_NUMBER: Record<ArchiveLevel, number> = { store: 0, normal: 6, max: 9 };

export const DATA_OPTIONS: EngineOption[] = [
  {
    key: 'csvDelimiter',
    labelKey: 'options.csvDelimiter.label',
    helpKey: 'options.csvDelimiter.help',
    advanced: false,
    type: 'select',
    default: 'semicolon',
    choices: (['semicolon', 'comma', 'tab'] as const).map((value) => ({
      value,
      labelKey: `options.csvDelimiter.${value}`,
      helpKey: `options.csvDelimiter.${value}Help`,
    })),
    appliesTo: ['csv'],
  },
  {
    key: 'jsonIndent',
    labelKey: 'options.jsonIndent.label',
    helpKey: 'options.jsonIndent.help',
    advanced: true,
    type: 'boolean',
    default: true,
    appliesTo: ['json'],
  },
];

export interface DataOptions {
  delimiter: ';' | ',' | '\t';
  indent: boolean;
}

export function resolveDataOptions(raw: Record<string, unknown>): DataOptions {
  const d = raw['csvDelimiter'];
  return {
    delimiter: d === 'comma' ? ',' : d === 'tab' ? '\t' : ';',
    indent: raw['jsonIndent'] !== false,
  };
}
