import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import type { LogLimit } from '@conbert/schemas';

const MB = 1024 * 1024;
const CHUNK = 64 * 1024;

/** Counts the line breaks of a file (once, at the start). */
function countLines(file: string): number {
  if (!existsSync(file)) return 0;
  const fd = openSync(file, 'r');
  const buffer = Buffer.alloc(CHUNK);
  let lines = 0;
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, CHUNK, null);
      if (read === 0) break;
      for (let i = 0; i < read; i++) if (buffer[i] === 10) lines++;
    }
  } finally {
    closeSync(fd);
  }
  return lines;
}

const sizeOf = (file: string) => (existsSync(file) ? statSync(file).size : 0);

/**
 * The log on disk: one JSON line per entry in `conbert.log`. When it reaches
 * half the limit it becomes `conbert.log.1` (the older one goes) and a new
 * file starts – together they always stay below the limit, and no big file
 * ever has to be rewritten.
 */
export class LogFile {
  readonly current: string;
  readonly previous: string;
  private fd: number;
  private bytes: number;
  private lines: number;
  private previousLines: number;

  constructor(
    dir: string,
    private limit: LogLimit,
  ) {
    mkdirSync(dir, { recursive: true });
    this.current = path.join(dir, 'conbert.log');
    this.previous = `${this.current}.1`;
    this.fd = openSync(this.current, 'a');
    this.bytes = sizeOf(this.current);
    this.lines = countLines(this.current);
    this.previousLines = countLines(this.previous);
    this.trimPrevious();
    if (this.full()) this.rotate();
  }

  /** pino calls this with one finished JSON line at a time. */
  write(line: string): void {
    const buffer = Buffer.from(line);
    try {
      writeSync(this.fd, buffer);
    } catch {
      // Disk full or the file vanished: logging must never stop Conbert.
      return;
    }
    this.bytes += buffer.length;
    for (let i = 0; i < buffer.length; i++) if (buffer[i] === 10) this.lines++;
    if (this.full()) this.rotate();
  }

  setLimit(limit: LogLimit): void {
    this.limit = limit;
    this.trimPrevious();
    if (this.full()) this.rotate();
  }

  /** What the log holds right now (both files). */
  stats(): { bytes: number; lines: number } {
    return {
      bytes: this.bytes + sizeOf(this.previous),
      lines: this.lines + this.previousLines,
    };
  }

  /** Newest first: the files to read from. */
  files(): string[] {
    return [this.current, this.previous].filter((f) => existsSync(f));
  }

  clear(): void {
    closeSync(this.fd);
    rmSync(this.previous, { force: true });
    rmSync(this.current, { force: true });
    this.fd = openSync(this.current, 'a');
    this.bytes = 0;
    this.lines = 0;
    this.previousLines = 0;
  }

  close(): void {
    try {
      closeSync(this.fd);
    } catch {
      // Already closed.
    }
  }

  private half(): number {
    return this.limit.kind === 'size' ? (this.limit.mb * MB) / 2 : this.limit.count / 2;
  }

  private full(): boolean {
    return (this.limit.kind === 'size' ? this.bytes : this.lines) >= this.half();
  }

  /** A smaller limit: an older file that is too big now simply goes. */
  private trimPrevious(): void {
    const used = this.limit.kind === 'size' ? sizeOf(this.previous) : this.previousLines;
    if (used > this.half()) {
      rmSync(this.previous, { force: true });
      this.previousLines = 0;
    }
  }

  private rotate(): void {
    closeSync(this.fd);
    rmSync(this.previous, { force: true });
    renameSync(this.current, this.previous);
    this.previousLines = this.lines;
    this.fd = openSync(this.current, 'a');
    this.bytes = 0;
    this.lines = 0;
  }
}

/**
 * Reads lines from the end of a file towards its start, beginning before
 * `end` (a byte offset). `onLine` gets each line and where it starts; it
 * returns false to stop.
 */
export function readLinesBackwards(
  file: string,
  end: number,
  onLine: (line: string, start: number) => boolean,
): void {
  const fd = openSync(file, 'r');
  try {
    let position = Math.min(end, statSync(file).size);
    let rest = Buffer.alloc(0);
    while (position > 0) {
      const size = Math.min(CHUNK, position);
      position -= size;
      const chunk = Buffer.alloc(size);
      readSync(fd, chunk, 0, size, position);
      let buffer = Buffer.concat([chunk, rest]);
      let lineEnd = buffer.length;
      for (let i = buffer.length - 1; i >= 0; i--) {
        if (buffer[i] !== 10) continue;
        if (i + 1 < lineEnd) {
          const line = buffer.subarray(i + 1, lineEnd).toString('utf8');
          if (!onLine(line, position + i + 1)) return;
        }
        lineEnd = i;
      }
      rest = buffer.subarray(0, lineEnd);
      buffer = Buffer.alloc(0);
    }
    if (rest.length > 0) onLine(rest.toString('utf8'), 0);
  } finally {
    closeSync(fd);
  }
}
