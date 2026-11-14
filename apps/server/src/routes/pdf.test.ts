import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasCommand, setupAdmin, testApp, tusUpload } from '../test/helpers';
import { protectArgs, unlockArgs } from './pdf';

const fixtures = path.join(import.meta.dirname, '../__fixtures__');

describe('pdf password arguments', () => {
  it('never hands the password to a shell and keeps it one argument', () => {
    expect(protectArgs('a b"c', '/in', '/out')).toEqual([
      '--encrypt',
      'a b"c',
      'a b"c',
      '256',
      '--',
      '/in',
      '/out',
    ]);
    expect(unlockArgs('x', '/in', '/out')).toEqual(['--password=x', '--decrypt', '/in', '/out']);
  });
});

const installed = hasCommand('qpdf', ['--version']);

describe.skipIf(!installed)('pdf password route (real qpdf)', () => {
  let app: FastifyInstance;
  let cookie: string;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-pdf-'));
    app = await testApp({ CONBERT_DATA_DIR: dataDir });
    cookie = await setupAdmin(app);
  });
  afterAll(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const call = (fileId: string, action: string, password: string) =>
    app.inject({
      method: 'POST',
      url: '/api/pdf/password',
      headers: { cookie },
      payload: { fileId, action, password },
    });

  it('locks a PDF and opens it again with the right password only', async () => {
    const plain = readFileSync(path.join(fixtures, 'sample.pdf'));
    const id = await tusUpload(app, cookie, plain, 'sample.pdf');
    const password = ' Geheim äöü 123 ';
    const locked = await call(id, 'protect', password);
    expect(locked.statusCode).toBe(200);
    expect(locked.headers['content-type']).toContain('application/pdf');
    expect(locked.rawPayload.toString('latin1')).toMatch(/\/Encrypt/);

    const lockedId = await tusUpload(app, cookie, locked.rawPayload, 'locked.pdf');
    const wrong = await call(lockedId, 'unlock', 'falsch');
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toMatchObject({ error: { code: 'PDF_WRONG_PASSWORD' } });

    const opened = await call(lockedId, 'unlock', password);
    expect(opened.statusCode).toBe(200);
    expect(opened.rawPayload.toString('latin1')).not.toMatch(/\/Encrypt\s+\d+\s+\d+\s+R/);
  });

  it('refuses passwords with line breaks and files of other users', async () => {
    expect((await call('x', 'protect', 'a\nb')).statusCode).toBe(400);
    expect((await call('not-mine', 'protect', 'pw')).statusCode).toBe(404);
  });
});
