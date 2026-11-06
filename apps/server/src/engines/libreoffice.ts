import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ConversionError,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  type Category,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import { detectDelimiter } from '@conbert/core/data';
import { ProcessError, runProcess } from '../lib/run-process';

/**
 * LibreOffice without GUI (soffice --headless --convert-to). Every run gets a
 * fresh, locked-down user profile: macros off, no links to other servers –
 * documents from strangers must not run code or call home.
 */
const SOFFICE = process.env['CONBERT_SOFFICE_PATH'] ?? 'soffice';
const TIMEOUT_MS = 3 * 60 * 1000;

/** LibreOffice export filters (the part after "--convert-to"). */
const FILTERS: Record<string, string> = {
  pdf: 'pdf',
  docx: 'docx:MS Word 2007 XML',
  doc: 'doc:MS Word 97',
  odt: 'odt',
  rtf: 'rtf',
  txt: 'txt:Text (encoded):UTF8',
  html: 'html',
  xlsx: 'xlsx:Calc MS Excel 2007 XML',
  xls: 'xls:MS Excel 97',
  ods: 'ods',
  // Comma-separated, quoted text, UTF-8 (filter options 44,34,76).
  csv: 'csv:Text - txt - csv (StarCalc):44,34,76,1',
  pptx: 'pptx:Impress MS PowerPoint 2007 XML',
  ppt: 'ppt:MS PowerPoint 97',
  odp: 'odp',
};

/** Security settings for the throw-away profile (LibreOffice registry format). */
const PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseDocumentSystemFileLocking" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateLinkMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
`;

let status: EngineStatus = 'uninitialized';
let initPromise: Promise<void> | null = null;

function init(): Promise<void> {
  initPromise ??= (async () => {
    status = 'loading';
    try {
      await runProcess(SOFFICE, ['--version'], { timeoutMs: 60_000 });
      status = 'ready';
    } catch {
      status = 'error';
    }
  })();
  return initPromise;
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'LibreOffice needs a file path and workDir');
  }
  const from = normalizeExt(req.inputExt);
  const to = normalizeExt(req.outputExt);
  const filter = FILTERS[to];
  if (!filter)
    throw new ConversionError('errors.formatUnavailable', `LibreOffice can't write .${to}`);

  const id = randomUUID();
  const dir = path.join(req.workDir, `lo-${id}`);
  const profile = path.join(dir, 'profile');
  const out = path.join(dir, 'out');
  await mkdir(path.join(profile, 'user'), { recursive: true });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(profile, 'user', 'registrymodifications.xcu'), PROFILE);
  // LibreOffice picks the importer by content and extension – the upload has none.
  const input = path.join(dir, `input.${from}`);
  await copyFile(req.input, input);
  req.onProgress?.({ percent: 10, stage: 'converting' });

  try {
    const args = [
      `-env:UserInstallation=${pathToFileUrl(profile)}`,
      '--headless',
      '--norestore',
      '--nologo',
      '--nolockcheck',
      // CSV: separator detected from the first lines, text as UTF-8 (76).
      ...(from === 'csv' ? [`--infilter=CSV:${await csvSeparatorCode(input)},34,76,1`] : []),
      '--convert-to',
      filter,
      '--outdir',
      out,
      input,
    ];
    await runProcess(SOFFICE, args, {
      timeoutMs: TIMEOUT_MS,
      signal: req.signal,
      cwd: dir,
      env: { ...process.env, HOME: dir },
    });
    const [produced] = await readdir(out);
    if (!produced) {
      throw new ConversionError(
        'errors.convertFailed',
        'LibreOffice wrote no file (unsupported content?)',
      );
    }
    const output = path.join(req.workDir, `${id}.${to}`);
    await rename(path.join(out, produced), output);
    req.onProgress?.({ percent: 100, stage: 'done' });
    return output;
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    if (error instanceof ConversionError) throw error;
    const details =
      error instanceof ProcessError
        ? `${error.result.stderr}\n${error.result.stdout}`.trim().slice(-2000) || error.message
        : String(error);
    throw new ConversionError(
      /password|encrypted/i.test(details) ? 'errors.encrypted' : 'errors.convertFailed',
      details,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** LibreOffice wants the CSV separator as character code. */
async function csvSeparatorCode(file: string): Promise<number> {
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0);
    return detectDelimiter(buffer.subarray(0, bytesRead).toString('utf8')).charCodeAt(0);
  } finally {
    await handle.close();
  }
}

function pathToFileUrl(p: string): string {
  return `file://${p.startsWith('/') ? '' : '/'}${p.replace(/\\/g, '/')}`;
}

function engine(
  id: string,
  name: string,
  category: Category,
  read: string[],
  write: string[],
): Engine {
  return {
    id,
    name,
    descriptionKey: `engines.${id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}.description`,
    category,
    runtime: 'server',
    formats: [...new Set([...read, ...write])].map((ext) => ({
      ext,
      mime: getFormat(ext)?.mime ?? '',
      canRead: read.includes(ext),
      canWrite: write.includes(ext),
    })),
    options: [],
    supportsCompression: false,
    // Above pandoc (10): the layout of office files survives better.
    priority: 15,
    init,
    status: () => status,
    convert,
  };
}

/** Word, OpenDocument text, RTF. */
export const libreofficeWriterEngine = engine(
  'libreoffice-writer',
  'LibreOffice Writer',
  'document',
  ['doc', 'docx', 'odt', 'rtf'],
  ['pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'html'],
);

/** Excel, OpenDocument spreadsheets, CSV. */
export const libreofficeCalcEngine = engine(
  'libreoffice-calc',
  'LibreOffice Calc',
  'data',
  ['xls', 'xlsx', 'ods', 'csv'],
  ['pdf', 'xlsx', 'xls', 'ods', 'csv', 'html'],
);

/** PowerPoint and OpenDocument presentations. */
export const libreofficeImpressEngine = engine(
  'libreoffice-impress',
  'LibreOffice Impress',
  'document',
  ['ppt', 'pptx', 'odp'],
  ['pdf', 'pptx', 'ppt', 'odp'],
);
