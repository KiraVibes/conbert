import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { files } from '../db/schema';
import { sessionCookie, setupAdmin, testApp, tusUpload } from '../test/helpers';
import { runCleanup } from './cleanup';
import { sanitizeFileName } from './uploads';

const png = readFileSync(path.join(import.meta.dirname, '../__fixtures__/sample.png'));

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-data-'));
  app = await testApp({ CONBERT_DATA_DIR: dataDir, CONBERT_MAX_UPLOAD_MB: '1' });
});
afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function dbFiles() {
  return app.conbert.db.select().from(files).all();
}

describe('uploads (tus)', () => {
  it('stores an upload under a UUID and detects its type from the content', async () => {
    const cookie = await setupAdmin(app);
    const id = await tusUpload(app, cookie, png, '../../secret/Ferien Foto.JPG');
    const [record] = await dbFiles();
    expect(record).toMatchObject({
      id,
      ext: 'png',
      originalName: 'Ferien Foto.JPG',
      size: png.length,
    });
    expect(path.basename(record?.path ?? '')).toBe(id);
    expect(record?.path.startsWith(path.join(dataDir, 'uploads'))).toBe(true);
    expect(readFileSync(record?.path ?? '').equals(png)).toBe(true);
  });

  it('requires sign-in', async () => {
    await setupAdmin(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { 'tus-resumable': '1.0.0', 'upload-length': '10' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses files above the size limit', async () => {
    const cookie = await setupAdmin(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { cookie, 'tus-resumable': '1.0.0', 'upload-length': String(2 * 1024 * 1024) },
    });
    expect(res.statusCode).toBe(413);
  });

  it("keeps other users away from someone else's upload", async () => {
    const admin = await setupAdmin(app);
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: admin },
      payload: { username: 'bea', password: 'a long password' },
    });
    const bea = sessionCookie(
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'bea', password: 'a long password' },
      }),
    );
    const create = await app.inject({
      method: 'POST',
      url: '/api/upload',
      headers: { cookie: admin, 'tus-resumable': '1.0.0', 'upload-length': String(png.length) },
    });
    const location = String(create.headers['location']);
    const head = await app.inject({
      method: 'HEAD',
      url: location,
      headers: { cookie: bea, 'tus-resumable': '1.0.0' },
    });
    expect(head.statusCode).toBe(404);
    // A forged owner header from the client is ignored.
    const forged = await app.inject({
      method: 'HEAD',
      url: location,
      headers: { cookie: bea, 'tus-resumable': '1.0.0', 'x-conbert-user-id': 'whatever' },
    });
    expect(forged.statusCode).toBe(404);
  });

  it('deletes an own file on request', async () => {
    const cookie = await setupAdmin(app);
    const id = await tusUpload(app, cookie, png, 'a.png');
    const [record] = await dbFiles();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/files/${id}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(await dbFiles()).toEqual([]);
    expect(existsSync(record?.path ?? '')).toBe(false);
  });
});

describe('cleanup', () => {
  it('removes expired uploads with their data', async () => {
    const cookie = await setupAdmin(app);
    await tusUpload(app, cookie, png, 'a.png');
    const [record] = await dbFiles();
    const ctx = app.conbert;
    const early = await runCleanup(ctx, undefined, new Date());
    expect(early.files).toBe(0);
    ctx.db
      .update(files)
      .set({ expiresAt: new Date(0) })
      .where(eq(files.id, record?.id ?? ''))
      .run();
    const late = await runCleanup(ctx, undefined, new Date());
    expect(late.files).toBe(1);
    expect(existsSync(record?.path ?? '')).toBe(false);
  });
});

describe('sanitizeFileName', () => {
  it.each([
    ['photo.png', 'photo.png'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\x\\bild.jpg', 'bild.jpg'],
    ['bad\u0000name.png', 'badname.png'],
    ['', 'file'],
    [null, 'file'],
  ])('%s → %s', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });
});
