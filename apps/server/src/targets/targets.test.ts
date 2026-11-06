import { randomUUID } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { storageI18nKeys } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import type { SaveTargetRequest, StorageTargetDto } from '@conbert/schemas';
import { API_ERROR_KEYS } from '../lib/http-error';
import { hasMountedStorage } from '../routes/targets';
import { createSecretBox, SecretBoxError } from '../lib/secret-box';
import { hasCommand, setupAdmin, testApp, tusUpload } from '../test/helpers';
import { classifyRcloneError, rcloneObscure } from './rclone';
import { rcloneRemote } from './service';

describe('secret box', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'conbert-secret-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('encrypts so that only the same key and row can read it', () => {
    const box = createSecretBox('a-long-enough-secret', path.join(dir, 'unused'));
    const sealed = box.encrypt('geheim', 'row-1');
    expect(sealed).not.toContain('geheim');
    expect(box.decrypt(sealed, 'row-1')).toBe('geheim');
    // Moving the value to another row or user fails.
    expect(() => box.decrypt(sealed, 'row-2')).toThrow(SecretBoxError);
    // Another CONBERT_SECRET can't read it.
    const other = createSecretBox('another-long-secret', path.join(dir, 'unused'));
    expect(() => other.decrypt(sealed, 'row-1')).toThrow(SecretBoxError);
    // Two encryptions of the same text differ (random IV).
    expect(box.encrypt('geheim', 'row-1')).not.toBe(sealed);
  });

  it('creates a private key file once when no secret is set', () => {
    const file = path.join(dir, 'secret.key');
    const first = createSecretBox(undefined, file);
    expect(first.source).toBe('file');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    const sealed = first.encrypt('x', 'c');
    // A restart reads the same key.
    expect(createSecretBox(undefined, file).decrypt(sealed, 'c')).toBe('x');
  });
});

describe('rclone helpers', () => {
  it('explains rclone errors', () => {
    expect(classifyRcloneError('NT_STATUS_LOGON_FAILURE')).toBe('STORAGE_AUTH');
    expect(classifyRcloneError('ssh: unable to authenticate')).toBe('STORAGE_AUTH');
    expect(classifyRcloneError('InvalidAccessKeyId: The key does not exist')).toBe('STORAGE_AUTH');
    expect(classifyRcloneError('dial tcp: lookup nas.local: no such host')).toBe(
      'STORAGE_UNREACHABLE',
    );
    expect(classifyRcloneError('connect: connection refused')).toBe('STORAGE_UNREACHABLE');
    expect(classifyRcloneError('directory not found')).toBe('STORAGE_NOT_FOUND');
    expect(classifyRcloneError('x509: certificate signed by unknown authority')).toBe(
      'STORAGE_CERTIFICATE',
    );
    expect(classifyRcloneError('STATUS_ACCESS_DENIED')).toBe('STORAGE_DENIED');
    expect(classifyRcloneError('something odd')).toBe('STORAGE_FAILED');
  });

  it('builds rclone settings without putting secrets into paths', () => {
    const smb = rcloneRemote({
      type: 'smb',
      basePath: 'Urlaub',
      settings: { address: '\\\\192.168.1.10\\Fotos\\2024', user: 'anna' },
      secrets: { password: 'pw' },
    });
    expect(smb.root).toBe('conbert:Fotos/2024/Urlaub');
    expect(smb.options).toMatchObject({ type: 'smb', host: '192.168.1.10', user: 'anna' });
    expect(smb.options['pass']).not.toBe('pw');

    const sftp = rcloneRemote({
      type: 'sftp',
      basePath: '/volume1/photos',
      settings: { host: 'nas', user: 'anna' },
      secrets: { privateKey: '-----BEGIN KEY-----\nabc\n-----END KEY-----\n' },
    });
    expect(sftp.root).toBe('conbert:/volume1/photos');
    expect(sftp.options['key_pem']).toBe('-----BEGIN KEY-----\\nabc\\n-----END KEY-----');
    expect(sftp.options['shell_type']).toBe('none');

    const s3 = rcloneRemote({
      type: 's3',
      basePath: 'conbert',
      settings: { provider: 'Minio', bucket: 'backup', accessKeyId: 'AK' },
      secrets: { secretAccessKey: 'SK' },
    });
    expect(s3.root).toBe('conbert:backup/conbert');
    expect(s3.options).toMatchObject({ no_check_bucket: 'true', secret_access_key: 'SK' });

    const ftp = rcloneRemote({
      type: 'ftp',
      basePath: '',
      settings: { host: 'ftp.example.com', user: 'a', security: 'implicit' },
      secrets: {},
    });
    expect(ftp.root).toBe('conbert:');
    expect(ftp.options['tls']).toBe('true');
  });

  it.skipIf(!hasCommand('rclone', ['version']))(
    'obscures passwords the way rclone reads them',
    () => {
      const obscured = rcloneObscure('pässwört 123');
      const reveal = spawnSync('rclone', ['reveal', obscured], { encoding: 'utf8' });
      expect(reveal.stdout.trim()).toBe('pässwört 123');
    },
  );
});

describe('texts', () => {
  it('every storage field, type and error has its texts', () => {
    expect(findMissingKeys(storageI18nKeys())).toEqual([]);
    const storageErrors = Object.values(API_ERROR_KEYS).filter((k) =>
      k.startsWith('errors.storage'),
    );
    expect(
      findMissingKeys(storageErrors.flatMap((k) => [`${k}.what`, `${k}.cause`, `${k}.action`])),
    ).toEqual([]);
  });
});

// --- API -------------------------------------------------------------

let app: FastifyInstance;
let dataDir: string;
let storageRoot: string;
let cookie: string;

async function start() {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-targets-'));
  storageRoot = path.join(dataDir, 'storage');
  mkdirSync(storageRoot);
  app = await testApp({ CONBERT_DATA_DIR: dataDir, CONBERT_STORAGE_ROOTS: storageRoot });
  cookie = await setupAdmin(app);
}

async function stop() {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
}

const api = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  as = cookie,
) =>
  app.inject({
    method,
    url,
    headers: { cookie: as },
    ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
  });

const sftpTarget = (extra: Partial<SaveTargetRequest> = {}): SaveTargetRequest => ({
  name: 'NAS',
  type: 'sftp',
  basePath: '/fotos',
  usage: { asTarget: true, asSource: true },
  settings: { host: 'nas.local', user: 'anna' },
  secrets: { password: 'sehr-geheim' },
  ...extra,
});

describe('storage API', () => {
  beforeEach(start);
  afterEach(stop);

  it('renames a location and switches its use in one quick step', async () => {
    const first = (await api('POST', '/api/targets', sftpTarget({ isDefault: true }))).json<{
      target: StorageTargetDto;
    }>().target;
    const second = (
      await api(
        'POST',
        '/api/targets',
        sftpTarget({ name: 'Backup', usage: { asTarget: true, asSource: false } }),
      )
    ).json<{ target: StorageTargetDto }>().target;
    const patched = await api('PATCH', `/api/targets/${second.id}`, {
      name: 'Backup-Platte',
      usage: { asTarget: true, asSource: true },
      isDefault: true,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json<{ target: StorageTargetDto }>().target).toMatchObject({
      name: 'Backup-Platte',
      usage: { asTarget: true, asSource: true },
      isDefault: true,
      // Connection and password stay as they were.
      settings: { host: 'nas.local', user: 'anna', port: 22 },
      storedSecrets: ['password'],
    });
    const list = (await api('GET', '/api/targets')).json<{ targets: StorageTargetDto[] }>();
    expect(list.targets.find((t) => t.id === first.id)?.isDefault).toBe(false);
    // At least one use stays on; empty names don't count.
    expect(
      (
        await api('PATCH', `/api/targets/${second.id}`, {
          usage: { asTarget: false, asSource: false },
        })
      ).statusCode,
    ).toBe(400);
    expect((await api('PATCH', `/api/targets/${second.id}`, { name: '' })).statusCode).toBe(400);
    expect((await api('PATCH', `/api/targets/${randomUUID()}`, { name: 'x' })).statusCode).toBe(
      404,
    );
  });

  it('stores locations without ever sending secrets back', async () => {
    const created = await api('POST', '/api/targets', sftpTarget());
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain('sehr-geheim');
    const target = created.json<{ target: StorageTargetDto }>().target;
    expect(target.storedSecrets).toEqual(['password']);
    expect(target.settings).toEqual({ host: 'nas.local', user: 'anna', port: 22 });

    // In the database the password is encrypted.
    const row = app.conbert.db.$client
      .prepare('select secrets from storage_targets where id = ?')
      .get(target.id) as { secrets: string };
    expect(row.secrets).toMatch(/^v1\./);
    expect(row.secrets).not.toContain('sehr-geheim');

    // Updating without sending the password keeps it.
    const updated = await api('PUT', `/api/targets/${target.id}`, {
      ...sftpTarget({ name: 'NAS 2' }),
      secrets: {},
    });
    expect(updated.json<{ target: StorageTargetDto }>().target).toMatchObject({
      name: 'NAS 2',
      storedSecrets: ['password'],
    });
    const list = await api('GET', '/api/targets');
    expect(list.body).not.toContain('sehr-geheim');
    expect(list.json<{ targets: StorageTargetDto[] }>().targets).toHaveLength(1);
  });

  it('explains wrong input', async () => {
    const code = async (body: SaveTargetRequest) =>
      (await api('POST', '/api/targets', body)).json<{ error: { code: string } }>().error.code;
    expect(await code(sftpTarget({ settings: { user: 'a' } }))).toBe('STORAGE_FIELD_MISSING');
    expect(await code(sftpTarget({ secrets: {} }))).toBe('STORAGE_FIELD_MISSING');
    expect(await code({ ...sftpTarget(), type: 'smb', settings: { address: 'only-a-host' } })).toBe(
      'STORAGE_ADDRESS_INVALID',
    );
    expect(
      await code({ ...sftpTarget(), type: 'local', settings: { root: '/etc' }, secrets: {} }),
    ).toBe('STORAGE_ROOT_NOT_ALLOWED');
    expect(await code(sftpTarget({ basePath: '/a/../../etc' }))).toBe('STORAGE_PATH_INVALID');
    expect(await code({ ...sftpTarget(), type: 'gdrive' as SaveTargetRequest['type'] })).toBe(
      'STORAGE_TYPE_UNSUPPORTED',
    );
  });

  it('keeps every location private to its owner', async () => {
    const id = (await api('POST', '/api/targets', sftpTarget())).json<{
      target: StorageTargetDto;
    }>().target.id;
    await api('POST', '/api/users', { username: 'bert', password: 'another good password' });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'bert', password: 'another good password' },
    });
    const bert = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    expect((await api('GET', '/api/targets', undefined, bert)).json()).toEqual({ targets: [] });
    expect((await api('GET', `/api/targets/${id}/browse`, undefined, bert)).statusCode).toBe(404);
    expect((await api('DELETE', `/api/targets/${id}`, undefined, bert)).statusCode).toBe(404);
  });

  it('allows one default location', async () => {
    const a = (await api('POST', '/api/targets', sftpTarget({ isDefault: true }))).json<{
      target: StorageTargetDto;
    }>().target;
    await api('POST', '/api/targets', sftpTarget({ name: 'B', isDefault: true }));
    const targets = (await api('GET', '/api/targets')).json<{ targets: StorageTargetDto[] }>()
      .targets;
    expect(targets.filter((t) => t.isDefault).map((t) => t.name)).toEqual(['B']);
    expect(targets.find((t) => t.id === a.id)?.isDefault).toBe(false);
  });
});

// --- Real storage through rclone ---------------------------------------

const hasRclone = hasCommand('rclone', ['version']);

/** Saves a small file via upload + export, browses for it and opens it again. */
async function roundTrip(target: SaveTargetRequest) {
  const probe = await api('POST', '/api/targets/probe', { target, path: '' });
  expect(probe.statusCode, probe.body).toBe(200);
  // The wizard can create folders before the location is saved.
  const early = await api('POST', '/api/targets/probe/mkdir', { target, path: '', name: 'Vorab' });
  expect(early.statusCode, early.body).toBe(200);
  expect(early.json<{ path: string }>().path).toBe('Vorab');
  const created = await api('POST', '/api/targets', target);
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json<{ target: StorageTargetDto }>().target.id;

  const content = Buffer.from(`Hallo Speicherort ${target.type} – äöü`);
  const fileId = await tusUpload(app, cookie, content, 'Notiz.txt');
  const save = async () =>
    (await api('POST', `/api/files/${fileId}/export`, { targetIds: [id], folder: 'Ablage' })).json<{
      results: { status: string; path: string | null; error: unknown }[];
    }>().results[0];
  const first = await save();
  expect(first, JSON.stringify(first)).toMatchObject({ status: 'saved', path: 'Ablage/Notiz.txt' });
  // A second save with "rename" keeps both files.
  const second = await save();
  expect(second, JSON.stringify(second)).toMatchObject({
    status: 'saved',
    path: 'Ablage/Notiz (2).txt',
  });

  const browse = await api('GET', `/api/targets/${id}/browse?path=Ablage`);
  expect(browse.statusCode, browse.body).toBe(200);
  expect(browse.json<{ entries: { name: string }[] }>().entries.map((e) => e.name)).toEqual([
    'Notiz (2).txt',
    'Notiz.txt',
  ]);

  const imported = await api('POST', `/api/targets/${id}/import`, { paths: ['Ablage/Notiz.txt'] });
  expect(imported.statusCode, imported.body).toBe(200);
  const file = imported.json<{ files: { fileId: string; name: string; ext: string }[] }>().files[0];
  expect(file).toMatchObject({ name: 'Notiz.txt', ext: 'txt' });
  const back = await api('GET', `/api/files/${file?.fileId}/content`);
  expect(back.rawPayload.equals(content)).toBe(true);

  // Looking at a file before opening it: same bytes, nothing left behind.
  const preview = await api('GET', `/api/targets/${id}/file?path=Ablage/Notiz.txt`);
  expect(preview.statusCode, preview.body).toBe(200);
  expect(preview.rawPayload.equals(content)).toBe(true);
  await new Promise((r) => setTimeout(r, 50));
  expect(readdirSync(path.join(dataDir, 'tmp')).filter((n) => n.startsWith('preview-'))).toEqual(
    [],
  );
  const folderPreview = await api('GET', `/api/targets/${id}/file?path=Ablage`);
  expect(folderPreview.json<{ error: { code: string } }>().error.code).toBe('STORAGE_IS_FOLDER');

  const folder = await api('POST', `/api/targets/${id}/mkdir`, { path: 'Ablage', name: 'Neu' });
  expect(folder.statusCode, folder.body).toBe(200);
  return id;
}

describe.skipIf(!hasRclone)('local folders (real rclone)', () => {
  beforeEach(start);
  afterEach(stop);

  const local = (basePath = ''): SaveTargetRequest => ({
    name: 'Platte',
    type: 'local',
    basePath,
    usage: { asTarget: true, asSource: true },
    settings: { root: storageRoot },
  });

  it('saves, lists and opens files', async () => {
    mkdirSync(path.join(storageRoot, 'Conbert'));
    await roundTrip(local('Conbert'));
    expect(readFileSync(path.join(storageRoot, 'Conbert/Ablage/Notiz.txt'), 'utf8')).toContain(
      'äöü',
    );
  });

  it('never leaves the allowed folder', async () => {
    const id = (await api('POST', '/api/targets', local())).json<{ target: StorageTargetDto }>()
      .target.id;
    expect((await api('GET', `/api/targets/${id}/browse?path=../..`)).statusCode).toBe(400);
    const outside = mkdtempSync(path.join(os.tmpdir(), 'conbert-outside-'));
    writeFileSync(path.join(outside, 'secret.txt'), 'nope');
    try {
      symlinkSync(outside, path.join(storageRoot, 'link'), 'dir');
    } catch {
      return; // no symlinks allowed here (Windows without rights)
    }
    try {
      expect((await api('GET', `/api/targets/${id}/browse?path=link`)).statusCode).toBe(403);
      const imported = await api('POST', `/api/targets/${id}/import`, {
        paths: ['link/secret.txt'],
      });
      expect(imported.statusCode).toBe(403);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('reports a missing folder in plain words', async () => {
    const id = (await api('POST', '/api/targets', local())).json<{ target: StorageTargetDto }>()
      .target.id;
    const res = await api('GET', `/api/targets/${id}/browse?path=gibt-es-nicht`);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('STORAGE_NOT_FOUND');
  });
});

// --- Network servers: rclone serves SFTP, FTP, WebDAV and S3 itself ----

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error('port')),
      );
    });
  });
}

async function waitForPort(port: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (open) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`port ${port} did not open`);
}

describe.skipIf(!hasRclone)('network locations (real servers)', () => {
  const servers: ChildProcess[] = [];
  let served: string;
  const ports: Record<string, number> = {};

  beforeAll(async () => {
    served = mkdtempSync(path.join(os.tmpdir(), 'conbert-served-'));
    const cache = path.join(served, '.cache');
    for (const kind of ['sftp', 'ftp', 'webdav', 's3']) {
      // Every server gets its own folder, so the tests don't see each other's files.
      const folder = path.join(served, kind);
      mkdirSync(kind === 's3' ? path.join(folder, 'bucket') : folder, { recursive: true });
      const port = await freePort();
      ports[kind] = port;
      const auth =
        kind === 's3' ? ['--auth-key', 'AKTEST,SKTEST'] : ['--user', 'anna', '--pass', 'pw-123'];
      const child = spawn(
        'rclone',
        ['serve', kind, folder, '--addr', `127.0.0.1:${port}`, ...auth],
        { env: { ...process.env, RCLONE_CACHE_DIR: cache, RCLONE_CONFIG: '' }, stdio: 'ignore' },
      );
      servers.push(child);
      await waitForPort(port);
    }
  }, 60_000);

  afterAll(() => {
    for (const child of servers) child.kill();
    rmSync(served, { recursive: true, force: true });
  });

  beforeEach(start);
  afterEach(stop);

  const base = { usage: { asTarget: true, asSource: true }, basePath: '' } as const;

  it('SFTP', async () => {
    await roundTrip({
      ...base,
      name: 'SFTP',
      type: 'sftp',
      settings: { host: '127.0.0.1', port: ports['sftp'] ?? 0, user: 'anna' },
      secrets: { password: 'pw-123' },
    });
  });

  it('FTP', async () => {
    await roundTrip({
      ...base,
      name: 'FTP',
      type: 'ftp',
      settings: { host: '127.0.0.1', port: ports['ftp'] ?? 0, user: 'anna', security: 'none' },
      secrets: { password: 'pw-123' },
    });
  });

  it('WebDAV', async () => {
    await roundTrip({
      ...base,
      name: 'WebDAV',
      type: 'webdav',
      settings: { url: `http://127.0.0.1:${ports['webdav']}/`, vendor: 'other', user: 'anna' },
      secrets: { password: 'pw-123' },
    });
  });

  it('S3', { timeout: 120_000 }, async () => {
    await roundTrip({
      ...base,
      name: 'S3',
      type: 's3',
      basePath: 'conbert',
      settings: {
        provider: 'Other',
        endpoint: `http://127.0.0.1:${ports['s3']}`,
        bucket: 'bucket',
        accessKeyId: 'AKTEST',
      },
      secrets: { secretAccessKey: 'SKTEST' },
    });
  });

  it('says so when the password is wrong', async () => {
    const res = await api('POST', '/api/targets/probe', {
      target: {
        ...base,
        name: 'x',
        type: 'webdav',
        settings: { url: `http://127.0.0.1:${ports['webdav']}/`, vendor: 'other', user: 'anna' },
        secrets: { password: 'falsch' },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('STORAGE_AUTH');
  });

  it('says so when nothing answers', async () => {
    const res = await api('POST', '/api/targets/probe', {
      target: {
        ...base,
        name: 'x',
        type: 'sftp',
        settings: { host: '127.0.0.1', port: await freePort(), user: 'anna' },
        secrets: { password: 'pw' },
      },
    });
    expect(res.json<{ error: { code: string } }>().error.code).toBe('STORAGE_UNREACHABLE');
  });
});

// --- SMB: a real Samba server (only in the Docker test image, as root) ---

const canRunSamba =
  hasCommand('smbd', ['--version']) &&
  typeof process.getuid === 'function' &&
  process.getuid() === 0;

describe.skipIf(!hasRclone || !canRunSamba)('SMB (real Samba)', () => {
  let samba: ChildProcess | undefined;
  let dir: string;
  let port: number;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'conbert-smb-'));
    const share = path.join(dir, 'share');
    mkdirSync(path.join(share, 'Conbert'), { recursive: true });
    port = await freePort();
    const conf = path.join(dir, 'smb.conf');
    writeFileSync(
      conf,
      [
        '[global]',
        `smb ports = ${port}`,
        'bind interfaces only = yes',
        'interfaces = lo',
        `lock directory = ${dir}/lock`,
        `state directory = ${dir}/state`,
        `cache directory = ${dir}/cache`,
        `private dir = ${dir}/private`,
        `pid directory = ${dir}`,
        `ncalrpc dir = ${dir}/ncalrpc`,
        'passdb backend = tdbsam',
        'server min protocol = SMB2_10',
        'disable netbios = yes',
        '[Fotos]',
        `path = ${share}`,
        'read only = no',
        'force user = root',
        'valid users = conbert',
      ].join('\n'),
    );
    for (const d of ['lock', 'state', 'cache', 'private', 'ncalrpc']) mkdirSync(path.join(dir, d));
    spawnSync('useradd', ['-M', '-s', '/usr/sbin/nologin', 'conbert'], { timeout: 10_000 });
    spawnSync('smbpasswd', ['-c', conf, '-a', '-s', 'conbert'], { input: 'smb-pw-1\nsmb-pw-1\n' });
    // Own process group (detached), so smbd's signals to its group never reach the test runner.
    samba = spawn('smbd', ['--foreground', '--no-process-group', '-s', conf], {
      stdio: 'ignore',
      detached: true,
    });
    await waitForPort(port);
  }, 60_000);

  afterAll(() => {
    if (samba?.pid) {
      try {
        process.kill(-samba.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(start);
  afterEach(stop);

  it('saves to and opens from a Windows/NAS share', { timeout: 60_000 }, async () => {
    await roundTrip({
      name: 'NAS',
      type: 'smb',
      basePath: 'Conbert',
      usage: { asTarget: true, asSource: true },
      settings: { address: `\\\\127.0.0.1\\Fotos`, user: 'conbert', port },
      secrets: { password: 'smb-pw-1' },
    });
  });
});

describe('mounted storage roots', () => {
  it('offers a root only when something is mounted there', async () => {
    const plain = mkdtempSync(path.join(os.tmpdir(), 'conbert-root-'));
    try {
      expect(await hasMountedStorage(plain)).toBe(false);
      expect(await hasMountedStorage(path.join(plain, 'missing'))).toBe(false);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== 'linux')('recognises a real mount point', async () => {
    expect(await hasMountedStorage('/proc')).toBe(true);
  });
});
