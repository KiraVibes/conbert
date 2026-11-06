import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTokenResponseSchema, tokenListSchema } from '@conbert/schemas';
import { apiTokens } from '../db/schema';
import { sharpEngine } from '../engines/sharp';
import { setupAdmin, testApp } from '../test/helpers';

const png = readFileSync(path.join(import.meta.dirname, '../__fixtures__/sample.png'));

let app: FastifyInstance;
let dataDir: string;
let cookie: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-tokens-'));
  await sharpEngine.init();
  app = await testApp({ CONBERT_DATA_DIR: dataDir }, { engines: [sharpEngine] });
  cookie = await setupAdmin(app);
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function newToken(name = 'Home Assistant', expiresInDays: number | null = 90) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tokens',
    headers: { cookie },
    payload: { name, expiresInDays },
  });
  expect(res.statusCode, res.body).toBe(201);
  return createTokenResponseSchema.parse(res.json());
}

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
const errorCode = (res: { json: () => unknown }) =>
  (res.json() as { error?: { code?: string } }).error?.code;

describe('API tokens', () => {
  it('are shown once, work as login and can be revoked', async () => {
    const { token, secret } = await newToken();
    expect(secret).toMatch(/^cbt_[\w-]{40,}$/);
    expect(token.prefix).toBe(`${secret.slice(0, 10)}…`);

    const list = tokenListSchema.parse(
      (await app.inject({ url: '/api/tokens', headers: { cookie } })).json(),
    );
    expect(list.tokens).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(secret);

    const engines = await app.inject({ url: '/api/engines', headers: bearer(secret) });
    expect(engines.statusCode).toBe(200);
    const used = tokenListSchema.parse(
      (await app.inject({ url: '/api/tokens', headers: { cookie } })).json(),
    );
    expect(used.tokens[0]?.lastUsedAt).not.toBeNull();

    await app.inject({ method: 'DELETE', url: `/api/tokens/${token.id}`, headers: { cookie } });
    const after = await app.inject({ url: '/api/engines', headers: bearer(secret) });
    expect(after.statusCode).toBe(401);
    expect(errorCode(after)).toBe('INVALID_TOKEN');
  });

  it('can not manage tokens, users or passwords', async () => {
    const { secret } = await newToken();
    for (const url of ['/api/tokens', '/api/users', '/api/keys/me']) {
      const res = await app.inject({ url, headers: bearer(secret) });
      expect(res.statusCode, url).toBe(403);
      expect(errorCode(res)).toBe('TOKEN_NOT_ALLOWED');
    }
    const created = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: bearer(secret),
      payload: { name: 'sneaky' },
    });
    expect(created.statusCode).toBe(403);
  });

  it('stop working when they expire', async () => {
    const { token, secret } = await newToken('short', 30);
    app.conbert.db
      .update(apiTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(apiTokens.id, token.id))
      .run();
    const res = await app.inject({ url: '/api/engines', headers: bearer(secret) });
    expect(res.statusCode).toBe(401);
    expect((await newToken('forever', null)).token.expiresAt).toBeNull();
  });
});

describe('script endpoints', () => {
  it('convert a raw upload in one request, whatever the content type says', async () => {
    const { secret } = await newToken();
    const res = await app.inject({
      method: 'POST',
      url: `/api/convert?to=webp&name=${encodeURIComponent('Ferien Foto.png')}&options=${encodeURIComponent('{"quality":60}')}`,
      headers: { ...bearer(secret), 'content-type': 'application/x-www-form-urlencoded' },
      payload: png,
    });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['content-disposition']).toContain('Ferien Foto.webp');
    expect(res.rawPayload.subarray(8, 12).toString()).toBe('WEBP');
  });

  it('explain what went wrong', async () => {
    const { secret } = await newToken();
    const noWay = await app.inject({
      method: 'POST',
      url: '/api/convert?to=mp3&name=a.png',
      headers: bearer(secret),
      payload: png,
    });
    expect(noWay.statusCode).toBe(422);
    expect(errorCode(noWay)).toBe('NO_SERVER_ROUTE');

    const empty = await app.inject({
      method: 'POST',
      url: '/api/convert?to=webp',
      headers: { ...bearer(secret), 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(0),
    });
    expect(empty.statusCode).toBe(400);

    const badOptions = await app.inject({
      method: 'POST',
      url: '/api/convert?to=webp&options=nope',
      headers: bearer(secret),
      payload: png,
    });
    expect(badOptions.statusCode).toBe(400);
  });

  it('keep files for the step-by-step way (upload, job, result)', async () => {
    const { secret } = await newToken();
    const res = await app.inject({
      method: 'POST',
      url: '/api/files?name=bild.png',
      headers: { ...bearer(secret), 'content-type': 'image/png' },
      payload: png,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ file: { name: 'bild.png', ext: 'png' } });
  });
});
