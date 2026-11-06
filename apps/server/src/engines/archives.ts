import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  ARCHIVE_LEVEL_NUMBER,
  ARCHIVE_OPTIONS,
  ConversionError,
  abortError,
  getFormat,
  isAbortError,
  normalizeExt,
  resolveArchiveLevel,
  type ConvertRequest,
  type Engine,
  type EngineStatus,
} from '@conbert/core';
import { ProcessError, runProcess } from '../lib/run-process';

/**
 * Repacking archives with bsdtar (libarchive): reads ZIP, 7Z, TAR, TAR.GZ and
 * RAR, writes all but RAR. Before unpacking, the listing is checked: too many
 * files or too much unpacked data ("archive bomb") is refused. bsdtar itself
 * refuses absolute paths and "..", so nothing lands outside the job folder.
 */
const BSDTAR = process.env['CONBERT_BSDTAR_PATH'] ?? 'bsdtar';
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 20_000;
const MAX_UNPACKED_BYTES = 8 * 1024 * 1024 * 1024;

const READ = ['zip', '7z', 'tar', 'tgz', 'rar'];
const WRITE = ['zip', '7z', 'tar', 'tgz'];

let status: EngineStatus = 'uninitialized';

/** Sizes from `bsdtar -tv` (ls -l style: the 5th column is the size). */
export function unpackedSize(listing: string): { entries: number; bytes: number } {
  let entries = 0;
  let bytes = 0;
  for (const line of listing.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    entries++;
    bytes += Number(parts[4]) || 0;
  }
  return { entries, bytes };
}

function writeArgs(
  to: string,
  level: number,
  output: string,
  dir: string,
  names: string[],
): string[] {
  switch (to) {
    case 'zip':
      return [
        '-c',
        '-f',
        output,
        '--format',
        'zip',
        '--options',
        `zip:compression-level=${level}`,
        '-C',
        dir,
        ...names,
      ];
    case '7z':
      return [
        '-c',
        '-f',
        output,
        '--format',
        '7zip',
        '--options',
        `7zip:compression-level=${level}`,
        '-C',
        dir,
        ...names,
      ];
    case 'tgz':
      return [
        '-c',
        '-z',
        '-f',
        output,
        '--options',
        `gzip:compression-level=${Math.max(level, 1)}`,
        '-C',
        dir,
        ...names,
      ];
    default:
      return ['-c', '-f', output, '--format', 'pax', '-C', dir, ...names];
  }
}

async function convert(req: ConvertRequest): Promise<string> {
  if (req.signal?.aborted) throw abortError();
  if (typeof req.input !== 'string' || !req.workDir) {
    throw new ConversionError('errors.convertFailed', 'archives need a file path and workDir');
  }
  const to = normalizeExt(req.outputExt);
  if (!WRITE.includes(to))
    throw new ConversionError('errors.formatUnavailable', `can't write .${to}`);
  const id = randomUUID();
  const dir = path.join(req.workDir, `unpack-${id}`);
  const output = path.join(req.workDir, `${id}.${to}`);
  await mkdir(dir, { recursive: true });
  const run = (args: string[]) =>
    runProcess(BSDTAR, args, { timeoutMs: TIMEOUT_MS, signal: req.signal });

  try {
    req.onProgress?.({ percent: 5, stage: 'reading' });
    const { stdout } = await run(['-t', '-v', '-f', req.input]);
    const { entries, bytes } = unpackedSize(stdout);
    if (entries > MAX_ENTRIES || bytes > MAX_UNPACKED_BYTES) {
      throw new ConversionError('errors.archiveTooLarge', `${entries} entries, ${bytes} bytes`);
    }
    req.onProgress?.({ percent: 20, stage: 'converting' });
    await run(['-x', '-f', req.input, '-C', dir, '--no-same-owner', '--no-same-permissions']);
    req.onProgress?.({ percent: 60, stage: 'converting' });
    const names = await readdir(dir);
    if (names.length === 0) throw new ConversionError('errors.convertFailed', 'empty archive');
    const level = ARCHIVE_LEVEL_NUMBER[resolveArchiveLevel(req.options)];
    await run(writeArgs(to, level, output, dir, names));
  } catch (error) {
    if (req.signal?.aborted || isAbortError(error)) throw abortError();
    if (error instanceof ConversionError) throw error;
    const details =
      error instanceof ProcessError
        ? error.result.stderr.trim().slice(-2000) || error.message
        : String(error);
    throw new ConversionError(
      /passphrase|encrypt|password/i.test(details) ? 'errors.encrypted' : 'errors.convertFailed',
      details,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  req.onProgress?.({ percent: 100, stage: 'done' });
  return output;
}

export const archivesEngine: Engine = {
  id: 'archives',
  name: 'libarchive (bsdtar)',
  descriptionKey: 'engines.archives.description',
  category: 'archive',
  runtime: 'server',
  formats: [...new Set([...READ, ...WRITE])].map((ext) => ({
    ext,
    mime: getFormat(ext)?.mime ?? '',
    canRead: READ.includes(ext),
    canWrite: WRITE.includes(ext),
  })),
  options: ARCHIVE_OPTIONS,
  supportsCompression: true,
  priority: 10,
  async init() {
    try {
      await runProcess(BSDTAR, ['--version'], { timeoutMs: 10_000 });
      status = 'ready';
    } catch {
      status = 'error';
    }
  },
  status: () => status,
  convert,
};
