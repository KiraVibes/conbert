import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LogPage, LogSettingsResponse } from '@conbert/schemas';
import {
  argsForLog,
  runProcess,
  setProcessLog,
  type ProcessLogEntry,
} from '../lib/run-process';
import { setupAdmin, testApp } from '../test/helpers';
import { LogFile } from './log-file';
import { LogHub, parseLine } from './hub';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'conbert-log-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const line = (n: number) =>
  `${JSON.stringify({ level: 30, time: 1, msg: `entry ${String(n)}` })}\n`;

describe('the log file', () => {
  it('stays below a line limit by starting a new file at half of it', () => {
    const file = new LogFile(dir, { kind: 'lines', count: 1000 });
    for (let i = 0; i < 2600; i++) file.write(line(i));
    expect(file.stats().lines).toBeLessThanOrEqual(1000);
    expect(file.stats().lines).toBeGreaterThanOrEqual(500);
    file.close();
  });

  it('stays below a size limit and shrinks when the limit gets smaller', () => {
    const file = new LogFile(dir, { kind: 'size', mb: 1 });
    const big = `${JSON.stringify({ level: 30, msg: 'x'.repeat(1000) })}\n`;
    for (let i = 0; i < 3000; i++) file.write(big);
    expect(file.stats().bytes).toBeLessThanOrEqual(1024 * 1024);
    file.setLimit({ kind: 'lines', count: 1000 });
    expect(file.stats().lines).toBeLessThanOrEqual(1000);
    file.clear();
    expect(file.stats()).toEqual({ bytes: 0, lines: 0 });
    file.close();
  });

  it('counts what is already there after a restart', () => {
    const first = new LogFile(dir, { kind: 'lines', count: 1000 });
    for (let i = 0; i < 10; i++) first.write(line(i));
    first.close();
    const again = new LogFile(dir, { kind: 'lines', count: 1000 });
    expect(again.stats().lines).toBe(10);
    again.close();
  });
});

describe('the logger', () => {
  it('writes only what the chosen detail allows, and the change counts at once', () => {
    const hub = new LogHub({
      dir,
      console: null,
      settings: { detail: 'errors', limit: { kind: 'lines', count: 1000 } },
    });
    hub.logger.info({ area: 'system' }, 'not with errors only');
    hub.logger.error({ area: 'job' }, 'an error');
    expect(hub.read({ level: 'debug', limit: 10 }).entries.map((e) => e.msg)).toEqual(['an error']);
    const db = { insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ run() {} }) }) }) };
    hub.update(db as never, { detail: 'detailed', limit: { kind: 'lines', count: 1000 } });
    hub.logger.debug({ area: 'process', password: 'hunter2' }, 'details now');
    const page = hub.read({ level: 'debug', limit: 10 });
    expect(page.entries[0]).toMatchObject({ msg: 'details now', area: 'process', level: 'debug' });
    // Secrets never reach the file.
    expect(page.entries[0]?.details['password']).toBe('[secret]');
    hub.close();
  });

  it('pages from new to old and filters by level, area and text', () => {
    const hub = new LogHub({
      dir,
      console: null,
      settings: { detail: 'detailed', limit: { kind: 'lines', count: 1000 } },
    });
    for (let i = 0; i < 25; i++)
      hub.logger.info({ area: 'download', n: i }, `download ${String(i)}`);
    hub.logger.warn({ area: 'auth', user: 'bea' }, 'sign-in failed');
    const first = hub.read({ level: 'debug', limit: 10 });
    expect(first.entries[0]?.msg).toBe('sign-in failed');
    expect(first.entries[9]?.msg).toBe('download 16');
    const second = hub.read({ level: 'debug', limit: 10, before: first.next ?? undefined });
    expect(second.entries.map((e) => e.msg)).toEqual(
      Array.from({ length: 10 }, (_, i) => `download ${String(15 - i)}`),
    );
    expect(hub.read({ level: 'warn', limit: 10 }).entries).toHaveLength(1);
    expect(hub.read({ level: 'debug', area: 'auth', limit: 10 }).entries).toHaveLength(1);
    expect(hub.read({ level: 'debug', q: 'DOWNLOAD 2', limit: 50 }).entries).toHaveLength(6);
    hub.close();
  });

  it('reads odd lines without breaking', () => {
    expect(parseLine('not json', '0:0')).toBeNull();
    expect(parseLine('{"level":40,"msg":"x"}', '0:0')).toMatchObject({ level: 'warn', area: null });
  });

  it('reports every finished program, with the error output when it failed', async () => {
    const seen: ProcessLogEntry[] = [];
    setProcessLog((e) => seen.push(e));
    try {
      await runProcess(process.execPath, ['-e', 'console.error("boom"); process.exit(3)']).catch(
        () => undefined,
      );
    } finally {
      setProcessLog(null);
    }
    expect(seen[0]).toMatchObject({ code: 3, outcome: 'exit', stderr: 'boom' });
  });

  it('hides secrets in program arguments', () => {
    expect(argsForLog(['--password', 'hunter2', '--token=abc', 'file.jpg'])).toEqual([
      '--password',
      '[secret]',
      '--token=[secret]',
      'file.jpg',
    ]);
  });
});

describe('log API', () => {
  let app: FastifyInstance;
  let admin: string;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-logapi-'));
    app = await testApp({ CONBERT_DATA_DIR: dataDir }, { logging: { file: true } });
    admin = await setupAdmin(app);
  });
  afterEach(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('lets admins choose the detail and limit, read, download and clear', async () => {
    const settings = await app.inject({
      method: 'PUT',
      url: '/api/admin/logs/settings',
      headers: { cookie: admin },
      payload: { detail: 'detailed', limit: { kind: 'lines', count: 2000 } },
    });
    expect(settings.json<LogSettingsResponse>()).toMatchObject({
      detail: 'detailed',
      limit: { kind: 'lines', count: 2000 },
      enabled: true,
    });
    // A failed sign-in and (detailed) the request itself end up in the log.
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong password!' },
    });
    const page = (
      await app.inject({ url: '/api/admin/logs?limit=50', headers: { cookie: admin } })
    ).json<LogPage>();
    const messages = page.entries.map((e) => `${e.area ?? ''}:${e.msg}`);
    expect(messages).toContain('auth:sign-in failed');
    expect(messages).toContain('http:request');
    expect(JSON.stringify(page)).not.toContain('wrong password!');

    const download = await app.inject({
      url: '/api/admin/logs/download',
      headers: { cookie: admin },
    });
    expect(download.headers['content-type']).toContain('text/plain');
    expect(download.body).toContain('sign-in failed');

    const cleared = await app.inject({
      method: 'DELETE',
      url: '/api/admin/logs',
      headers: { cookie: admin },
    });
    expect(cleared.json<LogSettingsResponse>().usedLines).toBeLessThanOrEqual(1);
  });

  it('is for administrators only', async () => {
    expect((await app.inject({ url: '/api/admin/logs' })).statusCode).toBe(401);
  });
});
