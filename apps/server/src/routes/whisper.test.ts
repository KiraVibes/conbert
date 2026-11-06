import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { whisperStatusSchema } from '@conbert/schemas';
import { sessionCookie, setupAdmin, testApp } from '../test/helpers';

let app: FastifyInstance;
let dataDir: string;
let admin: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-whisper-api-'));
  app = await testApp({ CONBERT_DATA_DIR: dataDir }, { engines: [] });
  admin = await setupAdmin(app);
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Whisper settings API', () => {
  it('reports the models and lets the admin pick one', async () => {
    const res = await app.inject({ url: '/api/whisper', headers: { cookie: admin } });
    const status = whisperStatusSchema.parse(res.json());
    expect(status.defaultModel).toBe('small');
    expect(status.available).toBe(false);
    expect(status.models.map((m) => [m.id, m.installed])).toEqual([
      ['base', false],
      ['small', false],
      ['large-v3-turbo', false],
    ]);

    const changed = await app.inject({
      method: 'PUT',
      url: '/api/whisper/default',
      headers: { cookie: admin },
      payload: { model: 'large-v3-turbo' },
    });
    expect(whisperStatusSchema.parse(changed.json()).defaultModel).toBe('large-v3-turbo');

    const wrong = await app.inject({
      method: 'PUT',
      url: '/api/whisper/default',
      headers: { cookie: admin },
      payload: { model: 'gigantic' },
    });
    expect(wrong.statusCode).toBe(400);
  });

  it('keeps model management for admins', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: admin },
      payload: { username: 'lea', password: 'a long password', role: 'user' },
    });
    const user = sessionCookie(
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'lea', password: 'a long password' },
      }),
    );
    const res = await app.inject({
      method: 'PUT',
      url: '/api/whisper/default',
      headers: { cookie: user },
      payload: { model: 'base' },
    });
    expect(res.statusCode).toBe(403);
    const download = await app.inject({
      method: 'POST',
      url: '/api/whisper/models/base/download',
      headers: { cookie: user },
    });
    expect(download.statusCode).toBe(403);
  });
});
