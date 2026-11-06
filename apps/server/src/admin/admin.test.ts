import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { adminOverviewSchema, usageSchema } from '@conbert/schemas';
import { sharpEngine } from '../engines/sharp';
import { sessionCookie, setupAdmin, testApp, tusUpload } from '../test/helpers';
import { isLow } from './disk-watch';

const png = readFileSync(path.join(import.meta.dirname, '../__fixtures__/sample.png'));

let app: FastifyInstance;
let dataDir: string;
let admin: string;
let user: string;

const errorCode = (res: { json: () => unknown }) =>
  (res.json() as { error?: { code?: string } }).error?.code;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-admin-'));
  await sharpEngine.init();
  app = await testApp({ CONBERT_DATA_DIR: dataDir }, { engines: [sharpEngine] });
  admin = await setupAdmin(app);
  await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie: admin },
    payload: { username: 'lea', password: 'a long password', role: 'user' },
  });
  user = sessionCookie(
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'lea', password: 'a long password' },
    }),
  );
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const overview = async () =>
  adminOverviewSchema.parse(
    (await app.inject({ url: '/api/admin/overview', headers: { cookie: admin } })).json(),
  );
const usage = async (cookie: string) =>
  usageSchema.parse((await app.inject({ url: '/api/me/usage', headers: { cookie } })).json());

describe('storage quotas', () => {
  it('count uploads and stop new ones over the limit', async () => {
    expect(await usage(user)).toEqual({ usedBytes: 0, quotaBytes: null });
    await tusUpload(app, user, png, 'a.png');
    expect((await usage(user)).usedBytes).toBe(png.length);

    // Lea may keep a bit more than one picture.
    const lea = (await overview()).users.find((u) => u.username === 'lea');
    await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${lea?.id}/quota`,
      headers: { cookie: admin },
      payload: { quota: png.length + 10 },
    });
    expect((await usage(user)).quotaBytes).toBe(png.length + 10);

    const tooMuch = await app.inject({
      method: 'POST',
      url: '/api/files?name=b.png',
      headers: { cookie: user, 'content-type': 'image/png' },
      payload: png,
    });
    expect(tooMuch.statusCode).toBe(413);
    expect(errorCode(tooMuch)).toBe('QUOTA_EXCEEDED');

    // tus: refused when the upload is announced.
    await expect(tusUpload(app, user, png, 'c.png')).rejects.toThrow();

    // Unlimited for Lea again; the admin's default doesn't touch her then.
    await app.inject({
      method: 'PUT',
      url: '/api/admin/quota-default',
      headers: { cookie: admin },
      payload: { bytes: 1 },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${lea?.id}/quota`,
      headers: { cookie: admin },
      payload: { quota: 'unlimited' },
    });
    expect((await usage(user)).quotaBytes).toBeNull();
    expect((await usage(admin)).quotaBytes).toBe(1);
    const view = await overview();
    expect(view.quotaDefault).toBe(1);
    expect(view.users.find((u) => u.username === 'lea')).toMatchObject({
      quotaSetting: 'unlimited',
      usedBytes: png.length,
    });
  });
});

describe('admin dashboard', () => {
  it('shows system, disk, jobs and engines – only to admins', async () => {
    const view = await overview();
    expect(view.system.cpus).toBeGreaterThan(0);
    expect(view.disk.total).toBeGreaterThan(view.disk.free);
    expect(view.jobs).toMatchObject({ queued: 0, running: 0, failed24h: 0 });
    expect(view.engines.map((e) => e.id)).toContain('sharp');
    expect(view.users.map((u) => u.username).sort()).toEqual(['admin', 'lea']);

    const forbidden = await app.inject({ url: '/api/admin/overview', headers: { cookie: user } });
    expect(forbidden.statusCode).toBe(403);
  });

  it('offers Prometheus metrics', async () => {
    const res = await app.inject({ url: '/api/metrics', headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('conbert_jobs{status="queued"} 0');
    expect(res.body).toMatch(/conbert_disk_bytes\{kind="free"\} \d+/);
    expect(res.body).toContain('conbert_engine_up{engine="sharp"} 1');
    const forbidden = await app.inject({ url: '/api/metrics', headers: { cookie: user } });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe('disk warning', () => {
  it('warns below 5 % or 2 GB free', () => {
    const GB = 1024 ** 3;
    expect(isLow({ total: 1000 * GB, free: 40 * GB })).toBe(true);
    expect(isLow({ total: 1000 * GB, free: 60 * GB })).toBe(false);
    expect(isLow({ total: 20 * GB, free: 1.5 * GB })).toBe(true);
    expect(isLow({ total: 20 * GB, free: 3 * GB })).toBe(false);
  });
});
