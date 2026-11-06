import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, type Io } from './cli';

let dir: string;
let lines: { out: string[]; err: string[] };
let calls: { method: string; url: string; auth: string | null; body?: string }[];
let jobStatus: 'done' | 'error';

/** A tiny stand-in for the Conbert API. */
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const headers = new Headers(init?.headers);
  const body =
    init?.body instanceof Blob ? await init.body.text() : (init?.body as string | undefined);
  calls.push({ method, url, auth: headers.get('authorization'), ...(body && { body }) });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (headers.get('authorization') !== 'Bearer cbt_good') {
    return json({ error: { code: 'INVALID_TOKEN', messageKey: 'errors.invalidToken' } }, 401);
  }
  const { pathname } = new URL(url);
  if (pathname === '/api/engines') {
    return json({
      engines: [
        {
          status: 'ready',
          formats: [
            { ext: 'heic', canRead: true, canWrite: false },
            { ext: 'jpg', canRead: true, canWrite: true },
            { ext: 'png', canRead: true, canWrite: true },
          ],
        },
      ],
    });
  }
  if (pathname === '/api/files') return json({ file: { id: 'f1' } }, 201);
  if (pathname === '/api/jobs') {
    return json(
      {
        job: {
          id: 'j1',
          status: 'queued',
          progress: 0,
          stage: null,
          resultName: null,
          error: null,
        },
      },
      201,
    );
  }
  if (pathname === '/api/jobs/j1') {
    return json({
      job: {
        id: 'j1',
        status: jobStatus,
        progress: 100,
        stage: 'done',
        resultName: 'foto.jpg',
        error:
          jobStatus === 'error' ? { messageKey: 'errors.convertFailed', details: 'broken' } : null,
      },
    });
  }
  if (pathname === '/api/jobs/j1/result') return new Response('JPEGDATA');
  return json({ error: { code: 'NOT_FOUND', messageKey: 'errors.notFound' } }, 404);
};

const io = (env: Record<string, string> = {}): Io => ({
  out: (l) => lines.out.push(l),
  err: (l) => lines.err.push(l),
  env: { LANG: 'de_DE.UTF-8', ...env },
  configDir: path.join(dir, 'config'),
  fetch: fakeFetch,
  cwd: dir,
});

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'conbert-cli-'));
  lines = { out: [], err: [] };
  calls = [];
  jobStatus = 'done';
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('conbert CLI', () => {
  it('logs in, then converts a file next to the original', async () => {
    expect(await run(['login', 'https://conbert.test/', 'cbt_bad'], io())).toBe(1);
    expect(lines.err.join()).toContain('nicht angenommen');
    expect(await run(['login', 'https://conbert.test/', 'cbt_good'], io())).toBe(0);
    const saved = JSON.parse(readFileSync(path.join(dir, 'config', 'config.json'), 'utf8')) as {
      url: string;
    };
    expect(saved.url).toBe('https://conbert.test');

    writeFileSync(path.join(dir, 'foto.heic'), 'HEICDATA');
    const code = await run(['convert', 'foto.heic', '--to', 'JPG', '--option', 'quality=80'], io());
    expect(code).toBe(0);
    expect(readFileSync(path.join(dir, 'foto.jpg'), 'utf8')).toBe('JPEGDATA');
    expect(lines.out).toContain('foto.heic → foto.jpg');
    const upload = calls.find((c) => c.url.includes('/api/files'));
    expect(upload).toMatchObject({ method: 'POST', body: 'HEICDATA' });
    expect(upload?.url).toContain('name=foto.heic');
    const job = calls.find((c) => c.url.endsWith('/api/jobs'));
    expect(JSON.parse(job?.body ?? '{}')).toEqual({
      fileId: 'f1',
      outputExt: 'jpg',
      mode: 'convert',
      options: { quality: 80 },
    });
  });

  it('uses CONBERT_URL/CONBERT_TOKEN, an output folder and reports failures', async () => {
    const env = { CONBERT_URL: 'https://conbert.test', CONBERT_TOKEN: 'cbt_good' };
    writeFileSync(path.join(dir, 'a.png'), 'PNG');
    expect(await run(['convert', 'a.png', '--to', 'jpg', '--out', 'out'], io(env))).toBe(0);
    expect(readFileSync(path.join(dir, 'out', 'foto.jpg'), 'utf8')).toBe('JPEGDATA');

    jobStatus = 'error';
    expect(await run(['convert', 'a.png', 'missing.png', '--to', 'jpg'], io(env))).toBe(1);
    expect(lines.err.join('\n')).toContain('a.png: fehlgeschlagen (errors.convertFailed)');
    expect(lines.err.join('\n')).toContain('Datei nicht gefunden: missing.png');
  });

  it('explains what is missing and lists targets', async () => {
    expect(await run(['convert', 'x.png'], io())).toBe(1);
    expect(lines.err.at(-1)).toContain('Nicht angemeldet');
    const env = { CONBERT_URL: 'https://conbert.test', CONBERT_TOKEN: 'cbt_good', LANG: 'en_US' };
    expect(await run(['convert', 'x.png'], io(env))).toBe(2);
    expect(lines.err.at(-1)).toContain('--to');
    expect(await run(['formats', 'heic'], io(env))).toBe(0);
    expect(lines.out.at(-1)).toBe('heic can become: jpg, png');
    expect(await run(['--version'], io())).toBe(0);
    expect(await run([], io())).toBe(2);
  });
});
