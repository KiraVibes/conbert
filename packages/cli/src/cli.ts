import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

/**
 * conbert – the command line for your own Conbert server.
 *
 *   conbert login https://conbert.local cbt_…
 *   conbert convert foto.heic --to jpg
 *   conbert convert *.wav --to mp3 --option audioQuality=high --out converted/
 *   conbert formats heic
 *
 * Settings: ~/.config/conbert/config.json, or CONBERT_URL / CONBERT_TOKEN.
 */

export const VERSION = '0.1.3';

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  env: Record<string, string | undefined>;
  /** Where the settings file lives (tests use a temporary folder). */
  configDir: string;
  fetch: typeof fetch;
  cwd: string;
}

interface Config {
  url: string;
  token: string;
}

const TEXTS = {
  en: {
    usage: `conbert ${VERSION} – convert files on your Conbert server

Usage:
  conbert login <server address> <token>    save address and API token
  conbert convert <files…> --to <format>    convert (results next to the files)
      --out <folder>          save the results there instead
      --mode compress|ocr     compress (same format) or make PDFs searchable
      --option key=value      engine option, e.g. quality=80 (several allowed)
  conbert formats <format>                  what a format can become
  conbert --version

Create a token in Conbert under Settings → API access.
Instead of "login": CONBERT_URL and CONBERT_TOKEN.`,
    noConfig: 'Not logged in. Run: conbert login <server address> <token>',
    saved: (url: string) => `Saved. Conbert at ${url} answers.`,
    badLogin: (status: number) =>
      `The server didn't accept the token (HTTP ${status}). Create a new one under Settings → API access.`,
    unreachable: (url: string, why: string) => `Can't reach ${url}: ${why}`,
    needTarget: 'Which format? Add --to <format>, e.g. --to jpg',
    needFiles: 'Which files? e.g. conbert convert foto.heic --to jpg',
    missing: (file: string) => `File not found: ${file}`,
    uploading: (file: string) => `${file}: uploading …`,
    progress: (file: string, percent: number, stage: string) => `${file}: ${percent} % ${stage}`,
    done: (file: string, result: string) => `${file} → ${result}`,
    failed: (file: string, key: string, details: string) =>
      `${file}: failed (${key})${details ? `\n  ${details}` : ''}`,
    targets: (ext: string, list: string) =>
      list ? `${ext} can become: ${list}` : `The server can't convert ${ext} directly.`,
    badOption: (value: string) => `Option "${value}" must look like key=value`,
  },
  de: {
    usage: `conbert ${VERSION} – Dateien auf deinem Conbert-Server umwandeln

Aufruf:
  conbert login <Server-Adresse> <Token>    Adresse und API-Token speichern
  conbert convert <Dateien…> --to <Format>  umwandeln (Ergebnis neben die Datei)
      --out <Ordner>          Ergebnisse stattdessen dort ablegen
      --mode compress|ocr     komprimieren (gleiches Format) oder PDFs durchsuchbar machen
      --option schlüssel=wert Engine-Option, z. B. quality=80 (mehrfach möglich)
  conbert formats <Format>                  was aus einem Format werden kann
  conbert --version

Ein Token legst du in Conbert unter Einstellungen → API-Zugang an.
Statt „login“ gehen auch CONBERT_URL und CONBERT_TOKEN.`,
    noConfig: 'Nicht angemeldet. Führ aus: conbert login <Server-Adresse> <Token>',
    saved: (url: string) => `Gespeichert. Conbert unter ${url} antwortet.`,
    badLogin: (status: number) =>
      `Der Server hat das Token nicht angenommen (HTTP ${status}). Leg unter Einstellungen → API-Zugang ein neues an.`,
    unreachable: (url: string, why: string) => `${url} ist nicht erreichbar: ${why}`,
    needTarget: 'In welches Format? Ergänze --to <Format>, z. B. --to jpg',
    needFiles: 'Welche Dateien? z. B. conbert convert foto.heic --to jpg',
    missing: (file: string) => `Datei nicht gefunden: ${file}`,
    uploading: (file: string) => `${file}: wird hochgeladen …`,
    progress: (file: string, percent: number, stage: string) => `${file}: ${percent} % ${stage}`,
    done: (file: string, result: string) => `${file} → ${result}`,
    failed: (file: string, key: string, details: string) =>
      `${file}: fehlgeschlagen (${key})${details ? `\n  ${details}` : ''}`,
    targets: (ext: string, list: string) =>
      list ? `Aus ${ext} kann werden: ${list}` : `${ext} kann der Server nicht direkt umwandeln.`,
    badOption: (value: string) => `Option „${value}“ muss so aussehen: schlüssel=wert`,
  },
};

type Texts = (typeof TEXTS)['en'];

function texts(env: Io['env']): Texts {
  const lang = env['LC_ALL'] ?? env['LANG'] ?? env['LANGUAGE'] ?? '';
  return lang.toLowerCase().startsWith('de') ? TEXTS.de : TEXTS.en;
}

const configFile = (io: Io) => path.join(io.configDir, 'config.json');

async function loadConfig(io: Io): Promise<Config | null> {
  const url = io.env['CONBERT_URL'];
  const token = io.env['CONBERT_TOKEN'];
  if (url && token) return { url: url.replace(/\/+$/, ''), token };
  try {
    const saved = JSON.parse(await readFile(configFile(io), 'utf8')) as Partial<Config>;
    if (saved.url && saved.token) return { url: saved.url, token: saved.token };
  } catch {
    // No settings yet.
  }
  return null;
}

/** "80" → 80, "true" → true, else the text. */
function optionValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

interface Job {
  id: string;
  status: string;
  progress: number;
  stage: string | null;
  resultName: string | null;
  error: { messageKey: string; details?: string } | null;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly key: string,
    readonly details: string,
  ) {
    super(key);
  }
}

function client(io: Io, config: Config) {
  const call = async (pathname: string, init: RequestInit = {}) => {
    const response = await io.fetch(`${config.url}${pathname}`, {
      ...init,
      headers: { authorization: `Bearer ${config.token}`, ...init.headers },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { messageKey?: string; code?: string; details?: string };
      };
      throw new ApiError(
        response.status,
        body.error?.messageKey ?? body.error?.code ?? `HTTP ${response.status}`,
        body.error?.details ?? '',
      );
    }
    return response;
  };
  return {
    json: async <T>(pathname: string, init?: RequestInit) =>
      (await (await call(pathname, init)).json()) as T,
    raw: call,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function convertOne(
  io: Io,
  t: Texts,
  api: ReturnType<typeof client>,
  file: string,
  options: { to: string; mode: string; values: Record<string, unknown>; out: string | null },
): Promise<boolean> {
  const full = path.resolve(io.cwd, file);
  let blob: Blob;
  try {
    blob = await openAsBlob(full);
  } catch {
    io.err(t.missing(file));
    return false;
  }
  try {
    io.err(t.uploading(file));
    const { file: uploaded } = await api.json<{ file: { id: string } }>(
      `/api/files?name=${encodeURIComponent(path.basename(full))}`,
      { method: 'POST', body: blob, headers: { 'content-type': 'application/octet-stream' } },
    );
    let { job } = await api.json<{ job: Job }>('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileId: uploaded.id,
        outputExt: options.to,
        mode: options.mode,
        options: options.values,
      }),
    });
    let last = -1;
    while (job.status === 'queued' || job.status === 'running') {
      await sleep(500);
      ({ job } = await api.json<{ job: Job }>(`/api/jobs/${job.id}`));
      if (job.progress !== last) {
        last = job.progress;
        io.err(t.progress(file, job.progress, job.stage ?? job.status));
      }
    }
    if (job.status !== 'done') {
      io.err(t.failed(file, job.error?.messageKey ?? job.status, job.error?.details ?? ''));
      return false;
    }
    const result = await api.raw(`/api/jobs/${job.id}/result`);
    const name = job.resultName ?? `${path.parse(full).name}.${options.to}`;
    const folder = options.out ? path.resolve(io.cwd, options.out) : path.dirname(full);
    await mkdir(folder, { recursive: true });
    const target = path.join(folder, path.basename(name));
    await writeFile(target, new Uint8Array(await result.arrayBuffer()));
    io.out(t.done(file, path.relative(io.cwd, target) || target));
    return true;
  } catch (error) {
    if (error instanceof ApiError) io.err(t.failed(file, error.key, error.details));
    else io.err(t.failed(file, 'network', error instanceof Error ? error.message : String(error)));
    return false;
  }
}

/** Runs the command line; returns the exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  const t = texts(io.env);
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        to: { type: 'string' },
        out: { type: 'string' },
        mode: { type: 'string', default: 'convert' },
        option: { type: 'string', multiple: true, default: [] },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    io.err(t.usage);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values.version) {
    io.out(VERSION);
    return 0;
  }
  if (values.help || !command) {
    io.out(t.usage);
    return command || values.help ? 0 : 2;
  }

  if (command === 'login') {
    const [rawUrl, token] = rest;
    if (!rawUrl || !token) {
      io.err(t.usage);
      return 2;
    }
    const url = rawUrl.replace(/\/+$/, '');
    try {
      const response = await io.fetch(`${url}/api/engines`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        io.err(t.badLogin(response.status));
        return 1;
      }
    } catch (error) {
      io.err(t.unreachable(url, error instanceof Error ? error.message : String(error)));
      return 1;
    }
    await mkdir(io.configDir, { recursive: true });
    await writeFile(configFile(io), JSON.stringify({ url, token }, null, 2));
    // Only the owner may read the token.
    await chmod(configFile(io), 0o600).catch(() => undefined);
    io.out(t.saved(url));
    return 0;
  }

  const config = await loadConfig(io);
  if (!config) {
    io.err(t.noConfig);
    return 1;
  }
  const api = client(io, config);

  if (command === 'formats') {
    const ext = (rest[0] ?? '').toLowerCase().replace(/^\./, '');
    const { engines } = await api.json<{
      engines: {
        status: string;
        formats: { ext: string; canRead: boolean; canWrite: boolean }[];
      }[];
    }>('/api/engines');
    const targets = new Set<string>();
    for (const engine of engines) {
      if (engine.status === 'error') continue;
      if (!engine.formats.some((f) => f.ext === ext && f.canRead)) continue;
      for (const f of engine.formats) if (f.canWrite && f.ext !== ext) targets.add(f.ext);
    }
    io.out(t.targets(ext, [...targets].sort().join(', ')));
    return 0;
  }

  if (command === 'convert') {
    if (!values.to) {
      io.err(t.needTarget);
      return 2;
    }
    if (rest.length === 0) {
      io.err(t.needFiles);
      return 2;
    }
    const optionValues: Record<string, unknown> = {};
    for (const pair of values.option) {
      const eq = pair.indexOf('=');
      if (eq <= 0) {
        io.err(t.badOption(pair));
        return 2;
      }
      optionValues[pair.slice(0, eq)] = optionValue(pair.slice(eq + 1));
    }
    let failures = 0;
    for (const file of rest) {
      const ok = await convertOne(io, t, api, file, {
        to: values.to.toLowerCase().replace(/^\./, ''),
        mode: values.mode,
        values: optionValues,
        out: values.out ?? null,
      });
      if (!ok) failures++;
    }
    return failures === 0 ? 0 : 1;
  }

  io.err(t.usage);
  return 2;
}

/** Default places: ~/.config/conbert (or %APPDATA%\conbert on Windows). */
export function defaultConfigDir(env: Io['env']): string {
  if (process.platform === 'win32' && env['APPDATA']) return path.join(env['APPDATA'], 'conbert');
  return path.join(env['XDG_CONFIG_HOME'] ?? path.join(os.homedir(), '.config'), 'conbert');
}
