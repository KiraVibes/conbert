import { executableContent, isExecutableExt } from './executable';
import { extFromName } from './identify';
import { inspectProgram } from './program';
import type { ByteReader } from './reader';
import { findStrings } from './strings';
import { findZipEnd, readZipEntries } from './structure';
import { extractZipEntry } from './zip-tools';

/**
 * Danger check: "Can I open this file safely?" – looks for what makes files
 * dangerous: programs and scripts (also disguised ones), Office macros, PDF
 * scripts, tricks in archives and phishing pages. It only reads the file.
 */

export type DangerLevel = 'safe' | 'caution' | 'danger';

export interface DangerFinding {
  level: Exclude<DangerLevel, 'safe'>;
  /** Text key under `workshop.danger.findings.`. */
  key: DangerKey;
  values?: Record<string, string | number>;
}

export const DANGER_KEYS = [
  'program',
  'script',
  'shortcut',
  'shortcutCommand',
  'disguised',
  'doubleExt',
  'reversedName',
  'hiddenExt',
  'macros',
  'macroFormat',
  'externalTemplate',
  'externalLink',
  'dde',
  'oleObject',
  'pdfJavascript',
  'pdfLaunch',
  'pdfAutoAction',
  'pdfEmbedded',
  'pdfSubmit',
  'zipTraversal',
  'zipProgram',
  'zipBomb',
  'zipEncrypted',
  'zipNested',
  'diskImage',
  'htmlScript',
  'htmlPassword',
  'htmlForm',
  'svgScript',
  'mismatch',
] as const;
export type DangerKey = (typeof DANGER_KEYS)[number];

export interface DangerReport {
  level: DangerLevel;
  findings: DangerFinding[];
}

const SCRIPT_EXTS = new Set(['ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'bat', 'cmd', 'sh', 'scpt', 'applescript', 'reg', 'url', 'scf', 'inf']); // prettier-ignore
const DOCUMENT_EXTS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'txt', 'rtf', 'odt', 'mp3', 'mp4', 'zip', 'rar', 'csv', 'html']); // prettier-ignore
const MACRO_EXTS = new Set(['docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm', 'xlam', 'ppam']);
const DISK_IMAGES = new Set(['iso', 'img', 'vhd', 'vhdx', 'dmg']);
const ARCHIVES = /\.(zip|rar|7z|gz|tar|iso|img|cab|arj)$/i;
/** Whole-file text scans stop here (keywords sit at the start or are repeated). */
const SCAN_LIMIT = 32 * 1024 * 1024;

const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

function nameFindings(name: string, out: DangerFinding[]): void {
  if (/[‪-‮⁦-⁩]/.test(name)) out.push({ level: 'danger', key: 'reversedName' });
  const parts = name.toLowerCase().split('.');
  const last = parts.at(-1) ?? '';
  const inner = parts.at(-2)?.trim() ?? '';
  if (parts.length >= 3 && isExecutableExt(last) && DOCUMENT_EXTS.has(inner))
    out.push({ level: 'danger', key: 'doubleExt', values: { shown: inner, real: last } });
  // "foto.jpg            .exe": the real ending is pushed out of sight.
  if (/\s{4,}\.[a-z0-9]+$/i.test(name)) out.push({ level: 'danger', key: 'hiddenExt' });
}

async function zipFindings(reader: ByteReader, nameExt: string | null, out: DangerFinding[]) {
  const end = await findZipEnd(reader);
  if (!end) return;
  const entries = await readZipEntries(reader, end);
  const names = entries.map((e) => e.name);
  const text = async (entry: string): Promise<string> => {
    const e = entries.find((x) => x.name === entry);
    if (!e || e.encrypted || e.size > 8 * 1024 * 1024) return '';
    try {
      return new TextDecoder().decode(await extractZipEntry(reader, e));
    } catch {
      return '';
    }
  };

  // Office documents are ZIP files inside.
  const macro = names.find((n) => /(^|\/)vbaProject\.bin$/i.test(n));
  if (macro) out.push({ level: 'danger', key: 'macros' });
  else if (nameExt && MACRO_EXTS.has(nameExt)) out.push({ level: 'caution', key: 'macroFormat' });
  for (const rels of names.filter((n) => n.endsWith('.rels'))) {
    const xml = await text(rels);
    for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = m[0];
      if (!/TargetMode="External"/i.test(tag)) continue;
      const target = /Target="([^"]+)"/.exec(tag)?.[1] ?? '';
      if (/attachedTemplate/i.test(tag))
        out.push({ level: 'danger', key: 'externalTemplate', values: { url: target } });
      else if (/oleObject|frame|subDocument/i.test(tag))
        out.push({ level: 'caution', key: 'externalLink', values: { url: target } });
    }
  }
  const body =
    (await text('word/document.xml')) + (await text('xl/externalLinks/externalLink1.xml'));
  if (/\bDDE(AUTO)?\b/.test(body)) out.push({ level: 'danger', key: 'dde' });
  const ole = names.filter((n) => /embeddings\/oleObject\d*\.bin$/i.test(n)).length;
  if (ole > 0) out.push({ level: 'caution', key: 'oleObject', values: { count: ole } });

  // Archives.
  const traversal = names.find(
    (n) => n.includes('../') || n.includes('..\\') || /^([a-z]:)?[\\/]/i.test(n),
  );
  if (traversal) out.push({ level: 'danger', key: 'zipTraversal', values: { name: traversal } });
  const program = entries.find(
    (e) => !e.directory && isExecutableExt(extFromName(e.name.split('/').pop() ?? '') ?? ''),
  );
  const isOffice = names.includes('[Content_Types].xml');
  if (program && !isOffice)
    out.push({ level: 'danger', key: 'zipProgram', values: { name: program.name } });
  const size = entries.reduce((n, e) => n + e.size, 0);
  const packed = entries.reduce((n, e) => n + e.compressedSize, 0);
  if (size > 200 * 1024 * 1024 && packed > 0 && size / packed > 100)
    out.push({ level: 'danger', key: 'zipBomb', values: { ratio: Math.round(size / packed) } });
  if (entries.some((e) => e.encrypted)) out.push({ level: 'caution', key: 'zipEncrypted' });
  const nested = names.find((n) => ARCHIVES.test(n));
  if (nested && !isOffice)
    out.push({ level: 'caution', key: 'zipNested', values: { name: nested } });
}

function pdfFindings(text: string, out: DangerFinding[]) {
  if (/\/(JavaScript|JS)\b/.test(text)) out.push({ level: 'danger', key: 'pdfJavascript' });
  if (/\/Launch\b/.test(text)) out.push({ level: 'danger', key: 'pdfLaunch' });
  if (/\/(OpenAction|AA)\b/.test(text)) out.push({ level: 'caution', key: 'pdfAutoAction' });
  if (/\/EmbeddedFiles?\b/.test(text)) out.push({ level: 'caution', key: 'pdfEmbedded' });
  if (/\/SubmitForm\b/.test(text)) out.push({ level: 'caution', key: 'pdfSubmit' });
}

function markupFindings(text: string, svg: boolean, out: DangerFinding[]) {
  const scripted = /<script\b|\bon[a-z]+\s*=\s*["']|javascript:/i.test(text);
  if (svg) {
    if (scripted) out.push({ level: 'danger', key: 'svgScript' });
    return;
  }
  if (scripted) out.push({ level: 'caution', key: 'htmlScript' });
  if (/<input[^>]+type\s*=\s*["']?password/i.test(text))
    out.push({ level: 'danger', key: 'htmlPassword' });
  else if (/<form\b[^>]*action\s*=\s*["']?https?:/i.test(text))
    out.push({ level: 'caution', key: 'htmlForm' });
}

/**
 * `detectedExt` is the type found from the content (magic bytes), the name
 * gives what the file claims to be.
 */
export async function dangerCheck(
  reader: ByteReader,
  name: string,
  detectedExt: string | null,
): Promise<DangerReport> {
  const out: DangerFinding[] = [];
  const nameExt = extFromName(name);
  const head = await reader.read(0, Math.min(reader.size, 64 * 1024));
  nameFindings(name, out);

  const program =
    executableContent(head) &&
    inspectProgram(
      head.length < reader.size
        ? await reader.read(0, Math.min(reader.size, 64 * 1024 * 1024))
        : head,
    );
  const isLnk =
    head.length > 20 && head[0] === 0x4c && head[1] === 0 && head[4] === 0x01 && head[5] === 0x14;
  if (isLnk) {
    out.push({ level: 'danger', key: 'shortcut' });
    const all = findStrings(await reader.read(0, Math.min(reader.size, 1024 * 1024)), {
      minLength: 4,
    });
    const cmd = all.strings.find((s) =>
      /powershell|cmd(\.exe)?\b|mshta|wscript|cscript|rundll32|regsvr32|bitsadmin|certutil|curl|https?:\/\//i.test(
        s.text,
      ),
    );
    if (cmd)
      out.push({
        level: 'danger',
        key: 'shortcutCommand',
        values: { command: cmd.text.slice(0, 300) },
      });
  } else if (program) {
    out.push({ level: 'danger', key: 'program', values: { arch: program.arch } });
    if (nameExt && !isExecutableExt(nameExt))
      out.push({ level: 'danger', key: 'disguised', values: { shown: nameExt } });
  } else if ((nameExt && SCRIPT_EXTS.has(nameExt)) || (head[0] === 0x23 && head[1] === 0x21)) {
    out.push({ level: 'danger', key: 'script', values: { ext: nameExt ?? '' } });
  } else if (nameExt && isExecutableExt(nameExt) && !MACRO_EXTS.has(nameExt)) {
    out.push({ level: 'danger', key: 'program', values: { arch: '' } });
  }

  const real = detectedExt?.toLowerCase() ?? null;
  if (
    real === 'zip' ||
    (nameExt !== null &&
      /^(docx|xlsx|pptx|docm|xlsm|pptm|dotm|xltm|odt|ods|odp|zip|jar|apk|epub)$/.test(nameExt))
  ) {
    await zipFindings(reader, nameExt, out);
  }
  if (real === 'cfb' || nameExt === 'doc' || nameExt === 'xls' || nameExt === 'ppt') {
    const text = latin1(await reader.read(0, Math.min(reader.size, SCAN_LIMIT)));
    // The macro storage of old Office files ("_VBA_PROJECT", stored as UTF-16).
    if (
      text.includes('_\0V\0B\0A\0_\0P\0R\0O\0J\0E\0C\0T') ||
      text.includes('\0M\0a\0c\0r\0o\0s\0')
    )
      out.push({ level: 'danger', key: 'macros' });
  }
  if (real === 'pdf' || nameExt === 'pdf')
    pdfFindings(latin1(await reader.read(0, Math.min(reader.size, SCAN_LIMIT))), out);
  const looksMarkup =
    nameExt === 'html' ||
    nameExt === 'htm' ||
    nameExt === 'svg' ||
    nameExt === 'xhtml' ||
    /^\s*<(!doctype|html|svg|\?xml)/i.test(latin1(head.subarray(0, 512)));
  if (looksMarkup) {
    const text = latin1(await reader.read(0, Math.min(reader.size, SCAN_LIMIT)));
    markupFindings(text, nameExt === 'svg' || /<svg\b/i.test(text.slice(0, 2000)), out);
  }
  if ((nameExt && DISK_IMAGES.has(nameExt)) || real === 'iso' || real === 'dmg')
    out.push({ level: 'caution', key: 'diskImage' });
  // A document that is really something else (and not already flagged as a program).
  if (
    real &&
    nameExt &&
    real !== nameExt &&
    !program &&
    !out.some((f) => f.key === 'disguised') &&
    DOCUMENT_EXTS.has(nameExt) &&
    !(real === 'zip' && /^(docx|xlsx|pptx|odt|epub)$/.test(nameExt)) &&
    !(nameExt === 'jpeg' && real === 'jpg')
  )
    out.push({ level: 'caution', key: 'mismatch', values: { shown: nameExt, real } });

  const level: DangerLevel = out.some((f) => f.level === 'danger')
    ? 'danger'
    : out.length > 0
      ? 'caution'
      : 'safe';
  // Strongest first.
  out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
  return { level, findings: out };
}
