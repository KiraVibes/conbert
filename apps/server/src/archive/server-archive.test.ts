import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { unzipSync } from 'fflate';
import type { AdminOverview, ServerArchive } from '@conbert/schemas';
import { dataPaths } from '../config';
import { thumbnailPath } from '../downloader/thumbnails';
import { runCleanup } from '../storage/cleanup';
import { recordFile } from '../storage/uploads';
import { sessionCookie, setupAdmin, testApp } from '../test/helpers';
import { archiveFile } from './server-archive';

let app: FastifyInstance;
let dataDir: string;
let admin: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-archive-'));
  app = await testApp({ CONBERT_DATA_DIR: dataDir });
  admin = await setupAdmin(app);
});
afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const api = (
  method: 'GET' | 'PUT' | 'DELETE',
  url: string,
  cookie = admin,
  payload?: Record<string, unknown>,
) => app.inject({ method, url, headers: { cookie }, ...(payload && { payload }) });

const userId = (name: string) =>
  (
    app.conbert.db.$client.prepare('select id from users where username = ?').get(name) as {
      id: string;
    }
  ).id;

/** A downloaded file, kept in the archive like the downloader does it. */
async function put(name: string, content: string, owner = 'admin', thumb = false) {
  const id = crypto.randomUUID();
  const uploads = dataPaths(app.conbert.config).uploads;
  mkdirSync(uploads, { recursive: true });
  const file = path.join(uploads, id);
  writeFileSync(file, content);
  await recordFile(app.conbert, {
    id,
    userId: userId(owner),
    filePath: file,
    name,
    size: content.length,
  });
  archiveFile(app.conbert, id, 'Instagram · nasa');
  if (thumb) {
    mkdirSync(path.dirname(thumbnailPath(app.conbert.config, id)), { recursive: true });
    writeFileSync(thumbnailPath(app.conbert.config, id), 'jpeg');
  }
  return id;
}

describe('server archive', () => {
  it('lists what is kept, with its source and the day it goes', async () => {
    await put('a.txt', 'first');
    const before = Date.now();
    const list = (await api('GET', '/api/archive/files')).json<ServerArchive>();
    expect(list.keepHours).toBe(168);
    expect(list.files).toHaveLength(1);
    expect(list.files[0]).toMatchObject({ name: 'a.txt', size: 5, source: 'Instagram · nasa' });
    const goes = Date.parse(list.files[0]?.expiresAt ?? '');
    expect(goes - before).toBeGreaterThan(167 * 3600_000);
    expect(goes - before).toBeLessThan(169 * 3600_000);
  });

  it('keeps each user’s archive to themselves', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: admin },
      payload: { username: 'lea', password: 'a long password', role: 'user' },
    });
    const lea = sessionCookie(
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'lea', password: 'a long password' },
      }),
    );
    const mine = await put('mine.txt', 'x');
    await put('hers.txt', 'y', 'lea');
    const list = (await api('GET', '/api/archive/files', lea)).json<ServerArchive>();
    expect(list.files.map((f) => f.name)).toEqual(['hers.txt']);
    expect((await api('DELETE', `/api/archive/files/${mine}`, lea)).statusCode).toBe(404);
    expect((await api('GET', `/api/archive/zip?ids=${mine}`, lea)).statusCode).toBe(404);
  });

  it('packs several files into one ZIP, also with the same name twice', async () => {
    const a = await put('pic.jpg', 'one');
    const b = await put('pic.jpg', 'two');
    await put('other.txt', 'not wanted');
    const res = await api('GET', `/api/archive/zip?ids=${a},${b}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const entries = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(entries).sort()).toEqual(['pic (2).jpg', 'pic.jpg']);
    expect(Buffer.from(entries['pic.jpg'] ?? []).toString()).toBe('one');
    // Without ids: everything.
    const all = unzipSync(new Uint8Array((await api('GET', '/api/archive/zip')).rawPayload));
    expect(Object.keys(all)).toHaveLength(3);
  });

  it('deletes one file or everything, with the preview picture', async () => {
    const a = await put('a.txt', 'a', 'admin', true);
    await put('b.txt', 'b');
    expect((await api('GET', `/api/archive/files/${a}/thumb`)).statusCode).toBe(200);
    expect((await api('DELETE', `/api/archive/files/${a}`)).statusCode).toBe(204);
    expect(existsSync(thumbnailPath(app.conbert.config, a))).toBe(false);
    expect((await api('GET', `/api/files/${a}/content`)).statusCode).toBe(404);
    expect((await api('DELETE', '/api/archive/files')).statusCode).toBe(204);
    expect((await api('GET', '/api/archive/files')).json<ServerArchive>().files).toEqual([]);
  });

  it('the admin sets how long new files stay; the cleanup removes them afterwards', async () => {
    const res = await api('PUT', '/api/admin/archive-keep', admin, { hours: 24 });
    expect(res.json<AdminOverview>().archiveKeepHours).toBe(24);
    const id = await put('a.txt', 'a', 'admin', true);
    const [file] = (await api('GET', '/api/archive/files')).json<ServerArchive>().files;
    expect(Date.parse(file?.expiresAt ?? '') - Date.now()).toBeLessThan(25 * 3600_000);
    // Two days later it is gone, the preview picture too.
    await runCleanup(app.conbert, undefined, new Date(Date.now() + 48 * 3600_000));
    expect((await api('GET', '/api/archive/files')).json<ServerArchive>().files).toEqual([]);
    expect(existsSync(thumbnailPath(app.conbert.config, id))).toBe(false);
    expect((await api('PUT', '/api/admin/archive-keep', admin, { hours: 0 })).statusCode).toBe(400);
  });
});
