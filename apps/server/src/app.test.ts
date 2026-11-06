import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Engine } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import { apiErrorSchema, enginesResponseSchema, healthResponseSchema } from '@conbert/schemas';
import { API_ERROR_KEYS, buildApp } from './app';
import { loadConfig } from './config';
import { SECURITY_HEADERS } from './lib/security-headers';
import { TEST_SETUP_CODE, memoryDb, setupAdmin } from './test/helpers';

const fakeEngine: Engine = {
  id: 'fake',
  name: 'Fake',
  descriptionKey: 'engines.fake.description',
  category: 'image',
  runtime: 'server',
  formats: [{ ext: 'png', canRead: true, canWrite: true }],
  options: [],
  supportsCompression: false,
  priority: 1,
  init: () => Promise.resolve(),
  status: () => 'ready',
  convert: () => Promise.resolve('/tmp/out.png'),
};

describe('API without web build', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const config = loadConfig({
      CONBERT_WEB_DIR: path.join(os.tmpdir(), 'conbert-missing-web'),
      CONBERT_SETUP_CODE: TEST_SETUP_CODE,
    });
    app = await buildApp({ config, db: memoryDb(), engines: [fakeEngine], backgroundTasks: false });
  });
  afterAll(() => app.close());

  it('GET /api/health reports ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = healthResponseSchema.parse(res.json());
    expect(body.name).toBe('conbert');
  });

  it('GET /api/engines lists engines without functions', async () => {
    const cookie = await setupAdmin(app);
    const res = await app.inject({ method: 'GET', url: '/api/engines', headers: { cookie } });
    const body = enginesResponseSchema.parse(res.json());
    expect(body.engines).toHaveLength(1);
    expect(body.engines[0]).toMatchObject({ id: 'fake', status: 'ready', runtime: 'server' });
  });

  it('sends cross-origin isolation and security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers[name.toLowerCase()]).toBe(value);
    }
  });

  it('answers unknown API routes with a translatable 404 error', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.messageKey).toBe('errors.notFound');
  });

  it('answers other paths with 404 when there is no web build', async () => {
    const res = await app.inject({ method: 'GET', url: '/settings' });
    expect(res.statusCode).toBe(404);
  });
});

describe('API with web build', () => {
  let app: FastifyInstance;
  let webDir: string;

  beforeAll(async () => {
    webDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-web-'));
    mkdirSync(path.join(webDir, 'assets'));
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Conbert</title>');
    writeFileSync(path.join(webDir, 'assets', 'app-abc123.js'), 'console.log(1)');
    app = await buildApp({
      config: loadConfig({ CONBERT_WEB_DIR: webDir }),
      db: memoryDb(),
      backgroundTasks: false,
    });
  });
  afterAll(async () => {
    await app.close();
    rmSync(webDir, { recursive: true, force: true });
  });

  it('serves index.html at the root', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Conbert</title>');
    expect(res.headers['cross-origin-embedder-policy']).toBe('require-corp');
  });

  it('falls back to index.html for client-side routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Conbert</title>');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('caches hashed assets for a long time', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('still returns JSON 404 for unknown API routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });
});

describe('config', () => {
  it('uses port 3313 by default', () => {
    expect(loadConfig({}).port).toBe(3313);
  });

  it('rejects an invalid port with a readable message', () => {
    expect(() => loadConfig({ CONBERT_PORT: 'abc' })).toThrow(/CONBERT_PORT/);
  });
});

describe('help texts', () => {
  it('every API error has a three-part text in German and English', () => {
    const keys = Object.values(API_ERROR_KEYS).flatMap((k) => [
      `${k}.what`,
      `${k}.cause`,
      `${k}.action`,
    ]);
    expect(findMissingKeys(keys)).toEqual([]);
  });
});
