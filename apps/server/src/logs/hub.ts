import path from 'node:path';
import { eq } from 'drizzle-orm';
import pino, { type Logger } from 'pino';
import {
  DEFAULT_LOG_SETTINGS,
  logSettingsSchema,
  type LogDetail,
  type LogEntry,
  type LogLevel,
  type LogPage,
  type LogSettings,
} from '@conbert/schemas';
import type { DbOrTx } from '../db';
import { appSettings } from '../db/schema';
import { LogFile, readLinesBackwards } from './log-file';

const KEY = 'log';

/** The detail chosen in the admin area → the lowest pino level written to the file. */
const FILE_LEVEL: Record<LogDetail, number> = { errors: 50, normal: 30, detailed: 20 };
const LEVEL_NAMES: Record<number, LogLevel> = {
  60: 'error',
  50: 'error',
  40: 'warn',
  30: 'info',
  20: 'debug',
  10: 'debug',
};
const LEVEL_VALUES: Record<LogLevel, number> = { error: 50, warn: 40, info: 30, debug: 20 };
const PINO_LABELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
  100: 'silent',
};

/** Passwords, keys and cookies never reach the log, wherever they sit. */
const SECRET_KEYS = [
  'password',
  'newPassword',
  'bindPassword',
  'token',
  'refreshToken',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
  'cookies',
];
export const REDACT_PATHS = [
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((k) => `*.${k}`),
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
];

export function readLogSettings(db: DbOrTx): LogSettings {
  const row = db.select().from(appSettings).where(eq(appSettings.key, KEY)).get();
  const parsed = logSettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_LOG_SETTINGS;
}

function writeLogSettings(db: DbOrTx, value: LogSettings): void {
  db.insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

interface Writable {
  write(line: string): unknown;
}

/**
 * Hands every finished line to the console and the log file, each with its
 * own level (the file's level changes at run time). pino tells the level of
 * the line through `lastLevel` because of the metadata symbol.
 */
class LogTee {
  lastLevel = 0;

  constructor(
    private readonly console: Writable | null,
    private readonly consoleLevel: number,
    public file: LogFile | null,
    public fileLevel: number,
  ) {
    // Makes pino fill in `lastLevel` before every write.
    Object.defineProperty(this, Symbol.for('pino.metadata'), { value: true });
  }

  write(line: string): void {
    if (this.console && this.lastLevel >= this.consoleLevel) this.console.write(line);
    if (this.file && this.lastLevel >= this.fileLevel) this.file.write(line);
  }

  lowest(): number {
    return Math.min(this.console ? this.consoleLevel : 100, this.file ? this.fileLevel : 100);
  }
}

export interface LogHubOptions {
  /** Where `conbert.log` goes; null = no file (tests). */
  dir: string | null;
  /** The container's console; null = quiet. */
  console: { level: string; stream: Writable } | null;
  settings: LogSettings;
}

/** The server's logger, its log file and the settings the admin chooses. */
export class LogHub {
  readonly logger: Logger;
  private readonly tee: LogTee;
  private settings: LogSettings;

  constructor(options: LogHubOptions) {
    this.settings = options.settings;
    const file = options.dir ? new LogFile(options.dir, options.settings.limit) : null;
    const consoleLevel = options.console ? (pino.levels.values[options.console.level] ?? 30) : 100;
    this.tee = new LogTee(
      options.console?.stream ?? null,
      consoleLevel,
      file,
      FILE_LEVEL[options.settings.detail],
    );
    this.logger = pino(
      {
        level: PINO_LABELS[this.tee.lowest()] ?? 'silent',
        base: null,
        redact: { paths: REDACT_PATHS, censor: '[secret]' },
      },
      this.tee,
    );
  }

  get enabled(): boolean {
    return this.tee.file !== null;
  }

  current(): LogSettings & { usedBytes: number; usedLines: number; enabled: boolean } {
    const stats = this.tee.file?.stats() ?? { bytes: 0, lines: 0 };
    return {
      ...this.settings,
      usedBytes: stats.bytes,
      usedLines: stats.lines,
      enabled: this.enabled,
    };
  }

  /** Saves and applies at once (no restart needed). */
  update(db: DbOrTx, next: LogSettings, loggers: { level: string }[] = []): void {
    writeLogSettings(db, next);
    this.settings = next;
    this.tee.fileLevel = FILE_LEVEL[next.detail];
    this.tee.file?.setLimit(next.limit);
    const level = PINO_LABELS[this.tee.lowest()] ?? 'silent';
    this.logger.level = level;
    for (const other of loggers) other.level = level;
  }

  clear(): void {
    this.tee.file?.clear();
  }

  close(): void {
    this.tee.file?.close();
  }

  files(): string[] {
    return this.tee.file?.files() ?? [];
  }

  /**
   * The newest entries first, filtered; `before` continues an earlier page
   * ("<file>:<offset>", file 0 = current, 1 = the older one).
   */
  read(query: {
    level: LogLevel;
    area?: string | undefined;
    q?: string | undefined;
    before?: string | undefined;
    limit: number;
  }): LogPage {
    const files = this.tee.file ? [this.tee.file.current, this.tee.file.previous] : [];
    const [startFile, startOffset] = (query.before ?? '0:').split(':');
    const minLevel = LEVEL_VALUES[query.level];
    const needle = query.q?.toLowerCase();
    const entries: LogEntry[] = [];
    let next: string | null = null;
    for (let index = Number(startFile) || 0; index < files.length; index++) {
      const file = files[index];
      if (!file || !this.tee.file?.files().includes(file)) continue;
      const end =
        index === (Number(startFile) || 0) && startOffset ? Number(startOffset) : Infinity;
      readLinesBackwards(file, end, (line, start) => {
        if (entries.length >= query.limit) {
          next = `${String(index)}:${String(start + Buffer.byteLength(line) + 1)}`;
          return false;
        }
        const entry = parseLine(line, `${String(index)}:${String(start)}`);
        if (!entry) return true;
        if (LEVEL_VALUES[entry.level] < minLevel) return true;
        if (query.area && entry.area !== query.area) return true;
        if (needle && !line.toLowerCase().includes(needle)) return true;
        entries.push(entry);
        return true;
      });
      if (next) break;
    }
    return { entries, next };
  }
}

/** One JSON line → an entry for the page (null for anything unreadable). */
export function parseLine(line: string, id: string): LogEntry | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const { level, time, msg, area, ...details } = raw;
  const levelName = LEVEL_NAMES[Number(level)] ?? 'info';
  return {
    id,
    time: new Date(typeof time === 'number' ? time : Date.now()).toISOString(),
    level: levelName,
    area: typeof area === 'string' ? area : null,
    msg: typeof msg === 'string' ? msg : '',
    details,
  };
}

/** The log folder inside the data folder. */
export const logDir = (dataDir: string) => path.join(dataDir, 'logs');
