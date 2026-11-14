import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LYRICS_FONTS } from '@conbert/core';
import { setupAdmin, testApp } from '../test/helpers';
import { LYRICS_FONT_FILES } from './fonts';

describe('lyrics font route', () => {
  let app: FastifyInstance;
  let cookie: string;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-fonts-'));
    app = await testApp({ CONBERT_DATA_DIR: dataDir });
    cookie = await setupAdmin(app);
  });
  afterAll(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('has a file for every font', () => {
    expect(Object.keys(LYRICS_FONT_FILES).sort()).toEqual([...LYRICS_FONTS].sort());
  });

  it('only sends fonts from the fixed list', async () => {
    for (const font of ['nope', '..%2F..%2Fetc%2Fpasswd', 'constructor']) {
      const res = await app.inject({ url: `/api/fonts/lyrics/${font}`, headers: { cookie } });
      expect(res.statusCode).toBe(404);
    }
  });

  it('needs a login', async () => {
    expect((await app.inject({ url: '/api/fonts/lyrics/sans' })).statusCode).toBe(401);
  });

  it.skipIf(!existsSync(LYRICS_FONT_FILES.script))('sends the font file', async () => {
    const res = await app.inject({ url: '/api/fonts/lyrics/script', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('font/otf');
    expect(res.rawPayload.subarray(0, 4).toString('latin1')).toBe('OTTO');
  });
});
