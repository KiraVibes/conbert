import { createCipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { StorageEntry } from '@conbert/schemas';
import type { ApiErrorCode } from '../lib/http-error';
import { ProcessError, runProcess } from '../lib/run-process';

/**
 * rclone's "obscure" format for passwords in its config (AES-CTR with rclone's
 * published fixed key). It only hides passwords from casual looks – the real
 * protection is that they live in the child's environment only, never in
 * arguments, logs or files.
 */
const OBSCURE_KEY = Buffer.from([
  0x9c, 0x93, 0x5b, 0x48, 0x73, 0x0a, 0x55, 0x4d, 0x6b, 0xfd, 0x7c, 0x63, 0xc8, 0x86, 0xa9, 0x2b,
  0xd3, 0x90, 0x19, 0x8e, 0xb8, 0x12, 0x8a, 0xfb, 0xf4, 0xde, 0x16, 0x2b, 0x8b, 0x95, 0xf6, 0x38,
]);

export function rcloneObscure(plain: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-ctr', OBSCURE_KEY, iv);
  return Buffer.concat([iv, cipher.update(plain, 'utf8'), cipher.final()]).toString('base64url');
}

/** The one remote name; its settings come from RCLONE_CONFIG_CONBERT_* variables. */
export const REMOTE = 'conbert';

export interface RcloneSetup {
  /** Path to the rclone binary. */
  binary: string;
  /** Empty config file and a private home folder (cache) for rclone. */
  configFile: string;
  homeDir: string;
}

export interface RcloneRemote {
  /** Backend settings, e.g. { type: 'sftp', host: 'nas', pass: <obscured> }. */
  options: Record<string, string>;
  /** Remote path of the location's base folder, e.g. "conbert:Fotos/2024". */
  root: string;
}

/** Where rclone keeps its (empty) config file and cache. Created on first use. */
export function prepareRclone(binary: string, folder: string): RcloneSetup {
  return { binary, configFile: path.join(folder, 'rclone.conf'), homeDir: folder };
}

/** All settings come from the environment; the config file only has to exist. */
function ensureRcloneFolder(setup: RcloneSetup): void {
  if (existsSync(setup.configFile)) return;
  mkdirSync(setup.homeDir, { recursive: true, mode: 0o700 });
  writeFileSync(setup.configFile, '', { mode: 0o600 });
}

const SHORT_TIMEOUT_MS = 60_000;
const COPY_TIMEOUT_MS = 60 * 60_000;
/** Reading a whole location (media index) may take a while on a big NAS. */
const WALK_TIMEOUT_MS = 2 * 60 * 60_000;
/** A folder listing: up to a few thousand entries of JSON. */
const LIST_OUTPUT_BYTES = 16 * 1024 * 1024;

/** One file somewhere below a folder (path relative to that folder). */
export interface WalkedFile {
  path: string;
  size: number;
  modTime: string | null;
}
/** Big folders are cut off; the browser shows a hint. */
export const MAX_ENTRIES = 2000;

export class StorageError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly details: string,
  ) {
    super(`${code}: ${details}`);
    this.name = 'StorageError';
  }
}

/** Turns rclone's messages into an error people can act on. */
export function classifyRcloneError(stderr: string): ApiErrorCode {
  const s = stderr.toLowerCase();
  if (
    /x509|certificate|tls: |handshake failure/.test(s) &&
    !/no such host|connection refused/.test(s)
  ) {
    return 'STORAGE_CERTIFICATE';
  }
  if (
    /logon_failure|login incorrect|authentication fail|unable to authenticate|auth fail|401 unauthorized|invalidaccesskeyid|signaturedoesnotmatch|530 |access key id .* does not exist|status_logon|password/.test(
      s,
    )
  ) {
    return 'STORAGE_AUTH';
  }
  if (
    /no such host|connection refused|i\/o timeout|network is unreachable|no route to host|connection reset|context deadline exceeded|dial tcp|couldn't connect|eof$|timed out/.test(
      s,
    )
  ) {
    return 'STORAGE_UNREACHABLE';
  }
  if (
    /directory not found|object not found|not found|nosuchbucket|bad_network_name|no such file|404/.test(
      s,
    )
  ) {
    return 'STORAGE_NOT_FOUND';
  }
  if (
    /access_denied|access denied|permission denied|403 forbidden|read-only|accessdenied/.test(s)
  ) {
    return 'STORAGE_DENIED';
  }
  return 'STORAGE_FAILED';
}

interface LsjsonEntry {
  Name: string;
  IsDir: boolean;
  Size: number;
  ModTime?: string;
}

/** One storage location, reachable through rclone. */
export class RcloneConnection {
  constructor(
    private readonly setup: RcloneSetup,
    private readonly remote: RcloneRemote,
  ) {}

  /** Full rclone path for a path relative to the base folder. */
  private at(relative: string): string {
    if (relative === '') return this.remote.root;
    const sep = this.remote.root.endsWith(':') || this.remote.root.endsWith('/') ? '' : '/';
    return `${this.remote.root}${sep}${relative}`;
  }

  private env(): NodeJS.ProcessEnv {
    // A clean environment: nothing of Conbert's own (like CONBERT_SECRET) reaches rclone.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: this.setup.homeDir,
      RCLONE_CONFIG: this.setup.configFile,
      RCLONE_CACHE_DIR: this.setup.homeDir,
    };
    for (const [key, value] of Object.entries(this.remote.options)) {
      env[`RCLONE_CONFIG_${REMOTE.toUpperCase()}_${key.toUpperCase()}`] = value;
    }
    return env;
  }

  private async run(
    args: string[],
    timeoutMs = SHORT_TIMEOUT_MS,
    output: { maxBytes?: number; onStdout?: (chunk: string) => void } = {},
  ): Promise<string> {
    try {
      ensureRcloneFolder(this.setup);
      const result = await runProcess(
        this.setup.binary,
        [
          ...args,
          '--contimeout=15s',
          '--timeout=60s',
          '--low-level-retries=2',
          '--retries=1',
          '--log-level=ERROR',
        ],
        {
          env: this.env(),
          timeoutMs,
          ...(output.maxBytes && { maxStdoutBytes: output.maxBytes }),
          ...(output.onStdout && { onStdout: output.onStdout }),
        },
      );
      return result.stdout;
    } catch (error) {
      if (error instanceof ProcessError) {
        if (error.reason === 'timeout') throw new StorageError('STORAGE_UNREACHABLE', 'timeout');
        const details = error.result.stderr.trim() || error.message;
        // rclone's documented exit codes: 3 = folder not found, 4 = file not found.
        const code =
          error.result.code === 3 || error.result.code === 4
            ? 'STORAGE_NOT_FOUND'
            : classifyRcloneError(details);
        throw new StorageError(code, details.slice(-2000));
      }
      throw new StorageError('STORAGE_FAILED', String(error));
    }
  }

  /** Lists one folder (folders first, then by name). */
  async list(relative: string): Promise<{ entries: StorageEntry[]; truncated: boolean }> {
    const out = await this.run(
      ['lsjson', '--max-depth=1', '--no-mimetype', this.at(relative)],
      SHORT_TIMEOUT_MS,
      // The default keeps only the last 64 KB – a folder with a few hundred files is more.
      { maxBytes: LIST_OUTPUT_BYTES },
    );
    const raw = JSON.parse(out || '[]') as LsjsonEntry[];
    const entries = raw
      .map((e) => ({
        name: e.Name,
        isDir: e.IsDir,
        size: e.IsDir ? 0 : Math.max(0, e.Size),
        modTime: e.ModTime ?? null,
      }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    return { entries: entries.slice(0, MAX_ENTRIES), truncated: entries.length > MAX_ENTRIES };
  }

  /** One file or folder, or null if there is none. */
  async stat(relative: string): Promise<StorageEntry | null> {
    try {
      const out = await this.run(['lsjson', '--stat', '--no-mimetype', this.at(relative)]);
      const e = JSON.parse(out) as LsjsonEntry;
      return {
        name: e.Name,
        isDir: e.IsDir,
        size: Math.max(0, e.Size),
        modTime: e.ModTime ?? null,
      };
    } catch (error) {
      if (error instanceof StorageError && error.code === 'STORAGE_NOT_FOUND') return null;
      throw error;
    }
  }

  async mkdir(relative: string): Promise<void> {
    await this.run(['mkdir', this.at(relative)]);
  }

  async upload(localFile: string, relative: string): Promise<void> {
    await this.run(['copyto', localFile, this.at(relative)], COPY_TIMEOUT_MS);
  }

  async download(relative: string, localFile: string): Promise<void> {
    await this.run(['copyto', this.at(relative), localFile], COPY_TIMEOUT_MS);
  }

  /**
   * Every file below a folder, any number of them: rclone writes one entry
   * per line, so they are handed on while it is still reading.
   */
  async walk(
    relative: string,
    onFile: (file: WalkedFile) => void,
    maxDepth?: number,
  ): Promise<void> {
    let rest = '';
    const take = (line: string) => {
      const text = line.trim().replace(/,$/, '');
      if (!text.startsWith('{')) return;
      try {
        const e = JSON.parse(text) as LsjsonEntry & { Path?: string };
        if (e.IsDir) return;
        onFile({ path: e.Path ?? e.Name, size: Math.max(0, e.Size), modTime: e.ModTime ?? null });
      } catch {
        // A broken line (should not happen) is skipped.
      }
    };
    await this.run(
      [
        'lsjson',
        '-R',
        ...(maxDepth ? [`--max-depth=${String(maxDepth)}`] : []),
        '--files-only',
        '--no-mimetype',
        '--fast-list',
        this.at(relative),
      ],
      WALK_TIMEOUT_MS,
      {
        onStdout: (chunk) => {
          rest += chunk;
          const lines = rest.split('\n');
          rest = lines.pop() ?? '';
          lines.forEach(take);
        },
      },
    );
    take(rest);
  }

  /** Moves (or renames) a file or a whole folder within the location. */
  async move(from: string, to: string): Promise<void> {
    await this.run(['moveto', this.at(from), this.at(to)], COPY_TIMEOUT_MS);
  }

  /** Deletes one file. */
  async remove(relative: string): Promise<void> {
    await this.run(['deletefile', this.at(relative)]);
  }

  /** Removes one folder, only if it is empty (fails otherwise). */
  async removeFolderIfEmpty(relative: string): Promise<void> {
    await this.run(['rmdir', this.at(relative)]);
  }

  /** Removes empty folders below (and including) a folder – never files. */
  async removeEmptyFolders(relative: string): Promise<void> {
    await this.run(['rmdirs', this.at(relative)]);
  }
}
