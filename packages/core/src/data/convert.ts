import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file/universal';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import writeXlsxFile from 'write-excel-file/universal';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ConversionError } from '../errors';
import { resolveDataOptions } from '../options/files';

/**
 * Data formats: JSON, YAML, TOML, XML (trees) and CSV, XLSX (tables). The
 * same code runs in the browser worker and on the server. Trees become
 * tables when they are a list of similar entries; tables become lists.
 */

export const DATA_FORMATS = ['json', 'yaml', 'toml', 'xml', 'csv', 'xlsx'];
const TABLES = new Set(['csv', 'xlsx']);

type Row = Record<string, unknown>;
interface Table {
  columns: string[];
  rows: Row[];
}

/** The separator a CSV file most likely uses (counted in the first lines). */
export function detectDelimiter(sample: string): ';' | ',' | '\t' {
  const lines = sample.split(/\r?\n/).slice(0, 10).join('\n');
  const count = (c: string) => lines.split(c).length - 1;
  const counts: [';' | ',' | '\t', number][] = [
    [';', count(';')],
    [',', count(',')],
    ['\t', count('\t')],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0] && counts[0][1] > 0 ? counts[0][0] : ',';
}

/** "42" → 42, "true" → true – but "007" (postcodes!) and long numbers stay text. */
function smartValue(text: string): unknown {
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(text)) return Number(text);
  if (text === 'true') return true;
  if (text === 'false') return false;
  return text;
}

const decode = (data: Uint8Array) => new TextDecoder().decode(data).replace(/^\uFEFF/, '');

const invalid = (error: unknown) =>
  new ConversionError('errors.dataInvalid', error instanceof Error ? error.message : String(error));

const xmlParser = () =>
  new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: true, trimValues: true });

async function readTable(data: Uint8Array, ext: string): Promise<Table> {
  if (ext === 'csv') {
    const text = decode(data);
    const result = Papa.parse<string[]>(text, { delimiter: detectDelimiter(text), skipEmptyLines: true });
    if (result.errors.length > 0 && result.data.length === 0) throw invalid(result.errors[0]?.message);
    return fromGrid(result.data.map((row) => row.map((cell) => smartValue(cell))));
  }
  const sheets = await readXlsxFile(data.slice().buffer as ArrayBuffer);
  const first = sheets[0]?.data ?? [];
  return fromGrid(first.map((row) => row.map((cell) => (cell instanceof Date ? cell.toISOString() : cell))));
}

/** First row = column names. */
function fromGrid(grid: unknown[][]): Table {
  const [header = [], ...body] = grid;
  const columns = header.map((h, i) => (h === null || h === undefined || h === '' ? `Spalte${i + 1}` : String(h)));
  const rows = body.map((cells) => Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? null])));
  return { columns, rows };
}

async function readTree(data: Uint8Array, ext: string): Promise<unknown> {
  const text = decode(data);
  try {
    switch (ext) {
      case 'json':
        return JSON.parse(text);
      case 'yaml':
        return parseYaml(text);
      case 'toml':
        return parseToml(text);
      case 'xml':
        return xmlParser().parse(text, true);
      default:
        throw new ConversionError('errors.formatUnavailable', `data: can't read .${ext}`);
    }
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    throw invalid(error);
  }
}

const isPlainObject = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Nested objects become "a.b" columns, lists become JSON text. */
function flatten(value: unknown, prefix = '', out: Row = {}): Row {
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix || 'Wert'] = Array.isArray(value) ? JSON.stringify(value) : value;
  }
  return out;
}

/** A tree that is (or contains exactly one) list of entries → table. */
function treeToTable(tree: unknown): Table {
  let list: unknown[] | null = null;
  if (Array.isArray(tree)) {
    // A list at the top: entries, or plain values as one column.
    list = tree;
  } else if (isPlainObject(tree)) {
    // { personen: [...] } or XML's { personen: { person: [...] } } – but only lists of entries.
    const entries = (v: unknown): v is Row[] => Array.isArray(v) && v.length > 0 && v.every(isPlainObject);
    const direct = Object.values(tree).filter(entries);
    const inner = Object.values(tree).filter(isPlainObject).flatMap((o) => Object.values(o).filter(entries));
    list = direct.length === 1 ? (direct[0] ?? null) : inner.length === 1 ? (inner[0] ?? null) : null;
  }
  if (!list || list.length === 0 || !(list.every(isPlainObject) || list.every((r) => typeof r !== 'object'))) {
    throw new ConversionError('errors.dataNotTable');
  }
  const rows = list.map((r) => flatten(r));
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return { columns, rows };
}

/** XML element names: letters, digits, "-", "_", "." – no spaces, not starting with a digit. */
function xmlName(key: string): string {
  if (key.startsWith('@') || key === '#text') return key;
  const cleaned = key.replace(/[^\p{L}\p{N}_.-]/gu, '_');
  return /^[\p{L}_]/u.test(cleaned) ? cleaned : `_${cleaned}`;
}

function xmlSafe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(xmlSafe);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [xmlName(k), xmlSafe(v)]));
  }
  return value;
}

/** TOML has no null and needs a table at the top. */
function tomlSafe(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== null).map(tomlSafe);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, tomlSafe(v)]),
    );
  }
  return value;
}

async function writeOutput(value: unknown, table: Table | null, ext: string, raw: Record<string, unknown>): Promise<Uint8Array> {
  const options = resolveDataOptions(raw);
  const encode = (text: string) => new TextEncoder().encode(text);
  switch (ext) {
    case 'json':
      return encode(JSON.stringify(value, null, options.indent ? 2 : 0) + '\n');
    case 'yaml':
      return encode(stringifyYaml(value));
    case 'toml': {
      const top = isPlainObject(value) ? value : { eintraege: value };
      try {
        return encode(stringifyToml(tomlSafe(top) as Record<string, unknown>));
      } catch (error) {
        throw new ConversionError('errors.convertFailed', error instanceof Error ? error.message : String(error));
      }
    }
    case 'xml': {
      const keys = isPlainObject(value) ? Object.keys(value) : [];
      const root =
        isPlainObject(value) && keys.length === 1
          ? value
          : Array.isArray(value)
            ? { eintraege: { eintrag: value } }
            : { daten: value };
      const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@', format: true });
      return encode(`<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlSafe(root)) as string}`);
    }
    case 'csv': {
      const t = table ?? treeToTable(value);
      const csv = Papa.unparse(
        { fields: t.columns, data: t.rows.map((r) => t.columns.map((c) => r[c] ?? '')) },
        { delimiter: options.delimiter, newline: '\r\n' },
      );
      // The BOM tells Excel the file is UTF-8 (otherwise umlauts break).
      return encode(`\uFEFF${csv}\r\n`);
    }
    case 'xlsx': {
      const t = table ?? treeToTable(value);
      const cell = (v: unknown) =>
        v === null || v === undefined
          ? null
          : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string'
            ? v
            : JSON.stringify(v);
      const sheet = [
        t.columns.map((c) => ({ value: c, fontWeight: 'bold' as const })),
        ...t.rows.map((r) => t.columns.map((c) => cell(r[c]))),
      ];
      // The typings know several overloads; this is the single-sheet one (rows of cells).
      const blob = await (writeXlsxFile as (data: unknown) => { toBlob(): Promise<Blob> })(sheet).toBlob();
      return new Uint8Array(await blob.arrayBuffer());
    }
    default:
      throw new ConversionError('errors.formatUnavailable', `data: can't write .${ext}`);
  }
}

/** Converts between the data formats. */
export async function convertData(
  input: Uint8Array,
  inputExt: string,
  outputExt: string,
  options: Record<string, unknown> = {},
): Promise<Uint8Array> {
  if (TABLES.has(inputExt)) {
    const table = await readTable(input, inputExt);
    return writeOutput(table.rows, TABLES.has(outputExt) ? table : null, outputExt, options);
  }
  const tree = await readTree(input, inputExt);
  return writeOutput(tree, null, outputExt, options);
}

/** First rows of a table file – for the preview. */
export async function previewTable(
  input: Uint8Array,
  ext: string,
  limit = 200,
): Promise<{ columns: string[]; rows: unknown[][]; total: number }> {
  const table = await readTable(input, ext);
  return {
    columns: table.columns,
    rows: table.rows.slice(0, limit).map((r) => table.columns.map((c) => r[c] ?? '')),
    total: table.rows.length,
  };
}
