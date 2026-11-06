import { spawn, type ChildProcess } from 'node:child_process';
import { setPriority } from 'node:os';
import { StringDecoder } from 'node:string_decoder';

export interface RunOptions {
  /** Kill the process after this many milliseconds. */
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Called with each chunk of standard output (e.g. ffmpeg progress lines). */
  onStdout?: (chunk: string) => void;
  /** Called with each chunk of standard error (e.g. whisper.cpp progress). */
  onStderr?: (chunk: string) => void;
  /** Keep this much of the standard output (bytes, the end). Default 64 KB. */
  maxStdoutBytes?: number;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly result: RunResult,
    readonly reason: 'exit' | 'timeout' | 'aborted' | 'spawn',
  ) {
    super(message);
    this.name = 'ProcessError';
  }
}

/** Keeps the last part of a stream – enough for error messages, never unbounded. */
const MAX_OUTPUT = 64 * 1024;

/**
 * Converters run with a lower CPU priority (Unix "nice" 10), so the web
 * interface and the API stay responsive while a big video is encoding.
 */
export const PROCESS_NICE = 10;

/**
 * Appended to the error output when the system stopped a program, so the job
 * runner can explain it (engines pass the error output on as details).
 */
export const SYSTEM_KILL_MARK =
  '[conbert] stopped by the system (SIGKILL) – probably out of memory';

/** Engine error details that mean "the system stopped the program". */
export function isSystemKill(details: string | null | undefined): boolean {
  return details?.includes(SYSTEM_KILL_MARK) ?? false;
}

/** Gives a started program the lower converter priority. */
export function lowerPriority(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    setPriority(child.pid, PROCESS_NICE);
  } catch {
    // Not allowed here (some sandboxes) – the program runs at normal priority.
  }
}

/** Process groups only exist on Unix; Windows (development) kills the process itself. */
const USE_GROUPS = process.platform !== 'win32';

/**
 * Ends a program and everything it started (LibreOffice, for example, runs a
 * second process). Errors are ignored: the group may already be gone.
 */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (USE_GROUPS) {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // Group already gone – fall through to the process itself.
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Already exited.
  }
}

/**
 * Runs an external program. Always an argument array, never a shell, so
 * file names can't inject commands. Rejects on non-zero exit, timeout or
 * abort (the process is killed).
 */
export function runProcess(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      env: options.env ?? process.env,
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group, so a timeout or abort also ends helper processes.
      detached: USE_GROUPS,
    });
    lowerPriority(child);
    // Raw bytes, decoded once at the end: a character split between two chunks
    // (umlauts in JSON) would otherwise be garbled.
    const collector = (limit: number) => {
      const chunks: Buffer[] = [];
      let size = 0;
      return {
        add(chunk: Buffer) {
          chunks.push(chunk);
          size += chunk.length;
          while (size - (chunks[0]?.length ?? 0) >= limit && chunks.length > 1) {
            size -= chunks.shift()?.length ?? 0;
          }
        },
        text: () => {
          const all = Buffer.concat(chunks);
          return all.subarray(Math.max(0, all.length - limit)).toString('utf8');
        },
      };
    };
    const out = collector(options.maxStdoutBytes ?? MAX_OUTPUT);
    const errOut = collector(MAX_OUTPUT);
    // Keeps characters that are split between two chunks together.
    const decoder = new StringDecoder('utf8');
    child.stdout.on('data', (chunk: Buffer) => {
      out.add(chunk);
      options.onStdout?.(decoder.write(chunk));
    });
    const errDecoder = new StringDecoder('utf8');
    child.stderr.on('data', (chunk: Buffer) => {
      errOut.add(chunk);
      options.onStderr?.(errDecoder.write(chunk));
    });

    const finish = (error: ProcessError | null, code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      // Helpers that outlived the main program (daemons, child workers) go too.
      if (USE_GROUPS) killTree(child);
      const result = { code, stdout: out.text(), stderr: errOut.text() };
      if (error) reject(error);
      else resolve(result);
    };

    const kill = (reason: 'timeout' | 'aborted') => {
      killTree(child);
      finish(
        new ProcessError(
          `${command} ${reason}`,
          { code: null, stdout: out.text(), stderr: errOut.text() },
          reason,
        ),
        null,
      );
    };
    const onAbort = () => kill('aborted');
    const timer = options.timeoutMs
      ? setTimeout(() => kill('timeout'), options.timeoutMs)
      : undefined;
    if (options.signal?.aborted) kill('aborted');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) =>
      finish(
        new ProcessError(
          `${command}: ${err.message}`,
          { code: null, stdout: out.text(), stderr: errOut.text() },
          'spawn',
        ),
        null,
      ),
    );
    child.on('close', (code, signal) => {
      if (code === 0) return finish(null, code);
      // Killed from outside (not by us): almost always the memory limit of the
      // container or the system's out-of-memory killer.
      const killed = code === null && signal === 'SIGKILL';
      finish(
        new ProcessError(
          killed ? `${command} was stopped by the system` : `${command} exited with ${code}`,
          {
            code,
            stdout: out.text(),
            stderr: killed
              ? `${errOut.text()}
${SYSTEM_KILL_MARK}`
              : errOut.text(),
          },
          'exit',
        ),
        code,
      );
    });
  });
}
