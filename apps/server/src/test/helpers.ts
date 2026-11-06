import { spawnSync } from 'node:child_process';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app';
import { loadConfig, type Config } from '../config';
import { openDatabase, type Db } from '../db';

/** A fresh, migrated in-memory database for tests. */
export function memoryDb(): Db {
  return openDatabase(':memory:', loadConfig({}).migrationsDir);
}

export const TEST_SETUP_CODE = 'TEST-CODE';
export const ADMIN = { username: 'admin', password: 'correct horse battery' };

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    CONBERT_SETUP_CODE: TEST_SETUP_CODE,
    CONBERT_WEB_DIR: '/nonexistent',
    // Without it, a key file would be created in the data folder.
    CONBERT_SECRET: 'test-secret-for-conbert-tests',
    // The Docker test image has yt-dlp and gallery-dl there.
    ...(process.env['CONBERT_DOWNLOADER_BIN'] && {
      CONBERT_DOWNLOADER_BIN: process.env['CONBERT_DOWNLOADER_BIN'],
    }),
    ...env,
  });
}

export async function testApp(
  env: Record<string, string> = {},
  extra: Partial<Parameters<typeof buildApp>[0]> = {},
): Promise<FastifyInstance> {
  return buildApp({ config: testConfig(env), db: memoryDb(), backgroundTasks: false, ...extra });
}

/** "conbert_session=…" from a response, for the Cookie header of the next request. */
export function sessionCookie(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === 'conbert_session');
  if (!cookie) throw new Error(`no session cookie (status ${res.statusCode}: ${res.body})`);
  return `conbert_session=${cookie.value}`;
}

/** Runs the first-start setup and returns the admin's cookie. */
export async function setupAdmin(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { mode: 'local', setupCode: TEST_SETUP_CODE, ...ADMIN },
  });
  return sessionCookie(res);
}

/** Base URL of the app on a real socket (tus needs a real request stream). */
export async function listen(app: FastifyInstance): Promise<string> {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return `http://127.0.0.1:${address.port}`;
}

/** Uploads a buffer via the tus protocol and returns the new file id. */
export async function tusUpload(
  app: FastifyInstance,
  cookie: string,
  data: Buffer,
  fileName: string,
): Promise<string> {
  const base = await listen(app);
  const meta = `filename ${Buffer.from(fileName).toString('base64')}`;
  const create = await fetch(`${base}/api/upload`, {
    method: 'POST',
    headers: {
      cookie,
      'tus-resumable': '1.0.0',
      'upload-length': String(data.length),
      'upload-metadata': meta,
    },
  });
  if (create.status !== 201) throw new Error(`tus create ${create.status}: ${await create.text()}`);
  const location = create.headers.get('location') ?? '';
  const patch = await fetch(`${base}${location}`, {
    method: 'PATCH',
    headers: {
      cookie,
      'tus-resumable': '1.0.0',
      'upload-offset': '0',
      'content-type': 'application/offset+octet-stream',
    },
    body: new Uint8Array(data),
  });
  if (patch.status !== 204) throw new Error(`tus patch ${patch.status}: ${await patch.text()}`);
  return location.split('/').pop() ?? '';
}

/** true if a command-line tool is installed (checked once, synchronously, for skipIf). */
export function hasCommand(command: string, args: string[] = ['-version']): boolean {
  const result = spawnSync(command, args, { stdio: 'ignore', windowsHide: true });
  return result.error === undefined && result.status === 0;
}
