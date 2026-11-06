import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import {
  OCR_OPTIONS,
  cropBox,
  matchesFilter,
  renameWith,
  workflowI18nKeys,
  type ConvertRequest,
  type Engine,
} from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import type { WorkflowDto, WorkflowRunDto } from '@conbert/schemas';
import { storageTargets } from '../db/schema';
import { sharpEngine } from '../engines/sharp';
import { getOwnFile, recordFile } from '../storage/uploads';
import { runAfter } from './service';
import { hasCommand, setupAdmin, testApp } from '../test/helpers';

const fixtures = path.join(import.meta.dirname, '../__fixtures__');

let app: FastifyInstance;
let dataDir: string;
let cookie: string;
let userId: string;

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
  });
}

/** Puts a fixture into the upload store, as if it had been uploaded. */
async function upload(fixture: string, name = fixture): Promise<string> {
  const id = randomUUID();
  const target = path.join(dataDir, 'uploads', id);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(fixtures, fixture), target);
  const { size } = await import('node:fs/promises').then((fs) => fs.stat(target));
  await recordFile(app.conbert, { id, userId, filePath: target, name, size });
  return id;
}

const idle = () => (app.conbert.workflows.queue as unknown as { idle(): Promise<void> }).idle();

async function runSteps(fileIds: string[], steps: unknown[]): Promise<WorkflowRunDto> {
  const res = await call('POST', '/api/workflows/quick-run', { fileIds, steps, name: 'Test' });
  expect(res.statusCode, res.body).toBe(201);
  await idle();
  const id = res.json<{ run: WorkflowRunDto }>().run.id;
  return (await call('GET', `/api/workflow-runs/${id}`)).json<{ run: WorkflowRunDto }>().run;
}

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-workflows-'));
  await sharpEngine.init();
  app = await testApp({ CONBERT_DATA_DIR: dataDir }, { engines: [sharpEngine] });
  cookie = await setupAdmin(app);
  const me = await call('GET', '/api/auth/status');
  userId = me.json<{ user: { id: string } }>().user.id;
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('workflow rules', () => {
  it('filters by category, extension, width and size', () => {
    const png = { ext: 'png', size: 1000, width: 800 };
    expect(matchesFilter({ category: ['image'] }, png)).toBe(true);
    expect(matchesFilter({ category: ['video'] }, png)).toBe(false);
    expect(matchesFilter({ ext: ['jpg'] }, png)).toBe(false);
    expect(matchesFilter({ minWidth: 1000 }, png)).toBe(false);
    expect(matchesFilter({ minWidth: 1000 }, { ...png, width: null })).toBe(false);
    expect(matchesFilter({ maxSizeMb: 0.0001 }, png)).toBe(false);
    expect(matchesFilter({}, png)).toBe(true);
  });

  it('renames with placeholders', () => {
    const date = new Date(2026, 9, 29);
    expect(renameWith('{name}_{date}_{counter}', 'Foto.jpg', 7, date)).toBe('Foto_2026-10-29_007');
    expect(renameWith('../{name}', 'a.png', 1, date)).toBe('.._a');
  });

  it('every step, preset and template has its texts', () => {
    expect(findMissingKeys(workflowI18nKeys())).toEqual([]);
  });
});

describe('workflow runs', () => {
  it('runs OCR on PDFs and lets other files through unchanged', async () => {
    const seen: ConvertRequest[] = [];
    // Stand-in for ocrmypdf: copies the PDF and adds a marker.
    const fakeOcr: Engine = {
      id: 'ocrmypdf',
      name: 'fake OCR',
      descriptionKey: 'engines.ocrmypdf.description',
      category: 'pdf',
      runtime: 'server',
      formats: [{ ext: 'pdf', canRead: true, canWrite: true }],
      options: OCR_OPTIONS,
      supportsCompression: false,
      priority: 1,
      init: async () => {},
      status: () => 'ready',
      async convert(req) {
        seen.push(req);
        const out = path.join(req.workDir ?? dataDir, 'ocr.pdf');
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, Buffer.concat([readFileSync(req.input as string), Buffer.from('%OCR')]));
        return out;
      },
    };
    await app.close();
    app = await testApp({ CONBERT_DATA_DIR: dataDir }, { engines: [sharpEngine, fakeOcr] });
    cookie = await setupAdmin(app);
    userId = (await call('GET', '/api/auth/status')).json<{ user: { id: string } }>().user.id;

    const pdf = await upload('sample.pdf');
    const png = await upload('sample.png');
    const run = await runSteps([pdf, png], [{ kind: 'ocr', options: { ocrLanguage: 'eng' } }]);
    expect(run).toMatchObject({ status: 'done', done: 2, failed: 0 });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.options).toMatchObject({
      ocrLanguage: 'eng',
      ocrRotate: true,
      ocrMode: 'skip',
    });
    const result = getOwnFile(app.conbert, userId, run.files[0]?.resultFileId ?? '');
    expect(readFileSync(result.path).toString('latin1').endsWith('%OCR')).toBe(true);
    // The picture is the untouched original.
    expect(run.files[1]?.resultFileId).toBe(png);
  });

  it('fails clearly when OCR is not installed', async () => {
    const pdf = await upload('sample.pdf');
    const run = await runSteps([pdf], [{ kind: 'ocr', options: {} }]);
    expect(run).toMatchObject({ status: 'done', failed: 1 });
    expect(run.files[0]?.error?.messageKey).toBe('errors.workflowStepUnavailable');
  });

  it('resizes, converts and renames a picture; the result goes to the list', async () => {
    const file = await upload('sample.png');
    const run = await runSteps(
      [file],
      [
        { kind: 'filter', rule: { category: ['image'] } },
        { kind: 'edit', action: 'resize', params: { maxWidth: 10 } },
        { kind: 'convert', outputExt: 'webp', options: { quality: 80 } },
        { kind: 'edit', action: 'rename', params: { pattern: '{name}_web' } },
      ],
    );
    expect(run).toMatchObject({ status: 'done', done: 1, failed: 0 });
    const result = run.files[0];
    expect(result?.resultName).toBe('sample_web.webp');
    const record = getOwnFile(app.conbert, userId, result?.resultFileId ?? '');
    const meta = await sharp(record.path).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBeLessThanOrEqual(10);
  });

  it('crops pictures to the chosen shape', async () => {
    const file = await upload('sample.png');
    const before = await sharp(getOwnFile(app.conbert, userId, file).path).metadata();
    const run = await runSteps(
      [file],
      [{ kind: 'edit', action: 'crop', params: { ratio: '16:9', focus: 'attention' } }],
    );
    expect(run).toMatchObject({ status: 'done', done: 1 });
    const record = getOwnFile(app.conbert, userId, run.files[0]?.resultFileId ?? '');
    const meta = await sharp(record.path).metadata();
    const box = cropBox(before.width ?? 0, before.height ?? 0, '16:9');
    expect({ width: meta.width, height: meta.height }).toEqual(box);
  });

  it('leaves files alone that the filter skips', async () => {
    const file = await upload('sample.png');
    const run = await runSteps(
      [file],
      [
        { kind: 'filter', rule: { category: ['video'] } },
        { kind: 'convert', outputExt: 'webp', options: {} },
      ],
    );
    expect(run).toMatchObject({ status: 'done', skipped: 1, done: 0 });
  });

  it('marks a failing file and goes on with the others', async () => {
    const good = await upload('sample.png');
    const bad = await upload('sample.mp3');
    const run = await runSteps([bad, good], [{ kind: 'convert', outputExt: 'webp', options: {} }]);
    expect(run).toMatchObject({ status: 'done', done: 1, failed: 1 });
    expect(run.files[0]).toMatchObject({
      status: 'error',
      failedStep: 0,
      error: { messageKey: 'errors.noServerRoute' },
    });
    expect(run.files[1]?.status).toBe('done');
  });

  it.skipIf(!hasCommand('rclone', ['version']))(
    'downloads keep their channel folder when a workflow saves them',
    async () => {
      const targetId = randomUUID();
      app.conbert.db
        .insert(storageTargets)
        .values({
          id: targetId,
          userId,
          name: 'NAS',
          type: 'local',
          settings: { root: dataDir },
          subfolderPattern: '{platform}',
        })
        .run();
      const file = await upload('sample.png');
      const run = await runAfter(app.conbert, userId, { steps: [] }, [file], {
        toList: false,
        targetIds: [targetId],
        label: 'Test',
        source: 'NASA',
      });
      await idle();
      const done = (await call('GET', `/api/workflow-runs/${run.id}`)).json<{
        run: WorkflowRunDto;
      }>().run;
      expect(done.files[0], JSON.stringify(done)).toMatchObject({ status: 'done' });
      // {platform} is unknown here ("_"), the channel folder comes behind it.
      expect(readdirSync(path.join(dataDir, '_', 'NASA'))).toEqual(['sample.png']);
    },
  );

  it('test run: shows where it would save, saves nothing', async () => {
    const targetId = randomUUID();
    app.conbert.db
      .insert(storageTargets)
      .values({ id: targetId, userId, name: 'NAS', type: 'local', settings: { root: dataDir } })
      .run();
    const created = await call('POST', '/api/workflows', {
      name: 'Web',
      steps: [
        { kind: 'convert', outputExt: 'webp', options: {} },
        { kind: 'save', targetIds: [targetId] },
      ],
    });
    const wf = created.json<{ workflow: WorkflowDto }>().workflow;
    const file = await upload('sample.png');
    const res = await call('POST', `/api/workflows/${wf.id}/test`, { fileId: file });
    expect(res.statusCode, res.body).toBe(201);
    await idle();
    const run = (
      await call('GET', `/api/workflow-runs/${res.json<{ run: WorkflowRunDto }>().run.id}`)
    ).json<{ run: WorkflowRunDto }>().run;
    expect(run).toMatchObject({ test: true, status: 'done' });
    expect(run.files[0]).toMatchObject({ wouldSaveTo: ['NAS'], savedTo: [] });
    expect(run.files[0]?.resultName).toBe('sample.webp');
  });

  it('an unknown workshop trick is reported as not available', async () => {
    const file = await upload('sample.png');
    const run = await runSteps([file], [{ kind: 'workshop', trick: 'zip-in-image', params: {} }]);
    expect(run.files[0]?.error?.messageKey).toBe('errors.workflowStepUnavailable');
  });

  it('fixes a wrong extension with the workshop trick and keeps a right one', async () => {
    const wrong = await upload('sample.png', 'urlaub.jpg');
    const right = await upload('sample.png');
    const run = await runSteps(
      [wrong, right],
      [{ kind: 'workshop', trick: 'fix-extension', params: {} }],
    );
    expect(run.files.map((f) => [f.status, f.resultName])).toEqual([
      ['done', 'urlaub.png'],
      ['done', 'sample.png'],
    ]);
  });

  it('cuts off an archive hidden behind a picture', async () => {
    const png = readFileSync(path.join(fixtures, 'sample.png'));
    const zip = readFileSync(path.join(fixtures, 'sample.zip'));
    const id = randomUUID();
    const target = path.join(dataDir, 'uploads', id);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, Buffer.concat([png, zip]));
    await recordFile(app.conbert, {
      id,
      userId,
      filePath: target,
      name: 'katze.png',
      size: png.length + zip.length,
    });
    const clean = await upload('sample.png');
    const run = await runSteps(
      [id, clean],
      [{ kind: 'workshop', trick: 'strip-appended', params: {} }],
    );
    expect(run.files.map((f) => [f.status, f.resultSize])).toEqual([
      ['done', png.length],
      ['done', png.length],
    ]);
  });

  it('repairs broken checksums and the extension', async () => {
    const png = readFileSync(path.join(fixtures, 'sample.png'));
    const broken = Buffer.from(png);
    broken[30] = (broken[30] ?? 0) ^ 0xff;
    const id = randomUUID();
    const target = path.join(dataDir, 'uploads', id);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, broken);
    await recordFile(app.conbert, {
      id,
      userId,
      filePath: target,
      name: 'kaputt.jpg',
      size: broken.length,
    });
    const run = await runSteps([id], [{ kind: 'workshop', trick: 'repair', params: {} }]);
    expect(run.files[0]).toMatchObject({ status: 'done', resultName: 'kaputt.png' });
    const content = await call('GET', `/api/files/${run.files[0]?.resultFileId}/content`);
    expect(Buffer.from(content.rawPayload)).toEqual(png);
  });

  it('keeps a new name when only renaming', async () => {
    const file = await upload('sample.png');
    const run = await runSteps(
      [file],
      [{ kind: 'edit', action: 'rename', params: { pattern: 'Urlaub-{counter}' } }],
    );
    expect(run.files[0]?.resultName).toMatch(/^Urlaub-0*1\.png$/);
  });
});

describe('workflows', () => {
  it('are saved per user and exported without this server’s IDs', async () => {
    const targetId = randomUUID();
    const created = await call('POST', '/api/workflows', {
      name: 'Booru → WebP → NAS',
      keepOriginal: true,
      steps: [
        { kind: 'convert', outputExt: 'webp', options: { quality: 85 } },
        { kind: 'save', targetIds: [targetId] },
      ],
    });
    expect(created.statusCode, created.body).toBe(201);
    const wf = created.json<{ workflow: WorkflowDto }>().workflow;
    const exported = await call('GET', `/api/workflows/${wf.id}/export`);
    expect(exported.headers['content-disposition']).toContain('.conbert-workflow.json');
    const json = exported.json<{ steps: { targetIds?: string[] }[] }>();
    expect(json).toMatchObject({
      conbertWorkflow: 1,
      name: 'Booru → WebP → NAS',
      keepOriginal: true,
    });
    expect(json.steps[1]?.targetIds).toEqual([]);
    const imported = await call('POST', '/api/workflows/import', json);
    expect(imported.statusCode, imported.body).toBe(201);
    const bad = await call('POST', '/api/workflows/import', { hello: 'world' });
    expect(bad.json()).toMatchObject({ error: { code: 'WORKFLOW_IMPORT_INVALID' } });
    const list = await call('GET', '/api/workflows');
    expect(list.json<{ workflows: unknown[] }>().workflows).toHaveLength(2);
  });

  it('refuses runs over files of others', async () => {
    const res = await call('POST', '/api/workflows/quick-run', {
      fileIds: [randomUUID()],
      steps: [{ kind: 'convert', outputExt: 'webp', options: {} }],
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('notification channels', () => {
  it('stores secrets encrypted, never sends them back, and checks addresses', async () => {
    const res = await call('POST', '/api/notifications/channels', {
      name: 'Discord',
      type: 'discord',
      secrets: { webhookUrl: 'https://discord.com/api/webhooks/1/secret-token' },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.body).not.toContain('secret-token');
    expect(res.json()).toMatchObject({ channel: { storedSecrets: ['webhookUrl'] } });
    const evil = await call('POST', '/api/notifications/channels', {
      name: 'x',
      type: 'discord',
      secrets: { webhookUrl: 'https://evil.example/hook' },
    });
    expect(evil.json()).toMatchObject({ error: { code: 'NOTIFY_ADDRESS_INVALID' } });
    const missing = await call('POST', '/api/notifications/channels', {
      name: 'x',
      type: 'telegram',
    });
    expect(missing.json()).toMatchObject({ error: { code: 'NOTIFY_FIELD_MISSING' } });
  });
});
