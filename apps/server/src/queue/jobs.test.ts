import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { abortError, type Engine } from '@conbert/core';
import { jobSchema, wsServerMessageSchema, type JobDto } from '@conbert/schemas';
import { sharpEngine } from '../engines/sharp';
import { contentDisposition } from '../routes/jobs';
import { sessionCookie, setupAdmin, testApp, tusUpload } from '../test/helpers';
import { jobs, workflowRuns } from '../db/schema';
import { resumeWorkflowRuns } from '../workflows/executor';
import type { JobQueue } from './job-queue';
import { resumeJobs } from './runner';

const png = readFileSync(path.join(import.meta.dirname, '../__fixtures__/sample.png'));

let app: FastifyInstance;
let dataDir: string;
let cookie: string;

async function start(extra: Parameters<typeof testApp>[1] = {}) {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-jobs-'));
  await sharpEngine.init();
  app = await testApp({ CONBERT_DATA_DIR: dataDir }, { engines: [sharpEngine], ...extra });
  cookie = await setupAdmin(app);
}

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function createJob(fileId: string, outputExt: string, options = {}, as = cookie) {
  return app.inject({
    method: 'POST',
    url: '/api/jobs',
    headers: { cookie: as },
    payload: { fileId, outputExt, options },
  });
}

async function waitForJob(id: string, status: JobDto['status']): Promise<JobDto> {
  let job: JobDto | undefined;
  await vi.waitFor(
    async () => {
      const res = await app.inject({ url: `/api/jobs/${id}`, headers: { cookie } });
      job = jobSchema.parse((res.json() as { job: unknown }).job);
      expect(job.status).toBe(status);
    },
    { timeout: 10_000, interval: 50 },
  );
  if (!job) throw new Error('no job');
  return job;
}

describe('server conversion jobs', () => {
  beforeEach(() => start());

  it('converts an upload and serves the result for download', async () => {
    const fileId = await tusUpload(app, cookie, png, 'Ferienfoto Übersee.png');
    const res = await createJob(fileId, 'webp', { quality: 50 });
    expect(res.statusCode).toBe(201);
    const created = jobSchema.parse((res.json() as { job: unknown }).job);
    expect(created).toMatchObject({ inputExt: 'png', outputExt: 'webp' });
    expect(created.steps).toEqual([{ engineId: 'sharp', from: 'png', to: 'webp' }]);

    const done = await waitForJob(created.id, 'done');
    expect(done).toMatchObject({ progress: 100, resultName: 'Ferienfoto Übersee.webp' });

    const result = await app.inject({ url: `/api/jobs/${created.id}/result`, headers: { cookie } });
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toBe('image/webp');
    expect(result.headers['content-disposition']).toContain(
      "filename*=UTF-8''Ferienfoto%20%C3%9Cbersee.webp",
    );
    expect(result.rawPayload.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('compresses a picture to a target size, never above it', async () => {
    // Noise packs badly: even low JPEG quality needs fewer pixels to fit.
    const noisy = await sharp({
      create: {
        width: 600,
        height: 400,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer();
    const fileId = await tusUpload(app, cookie, noisy, 'noise.png');
    const targetBytes = 30 * 1024;
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { cookie },
      payload: { fileId, outputExt: 'jpg', options: { targetBytes }, mode: 'compress' },
    });
    expect(res.statusCode).toBe(201);
    const done = await waitForJob(jobSchema.parse((res.json() as { job: unknown }).job).id, 'done');
    expect(done.resultSize).toBeLessThanOrEqual(targetBytes);
    expect(done.resultSize).toBeGreaterThan(targetBytes * 0.8);
  });

  it('explains when the server has no way for a conversion', async () => {
    const fileId = await tusUpload(app, cookie, png, 'a.png');
    const res = await createJob(fileId, 'docx');
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe('NO_SERVER_ROUTE');
  });

  it('marks broken files with a translatable error', async () => {
    const fileId = await tusUpload(app, cookie, Buffer.from('not really a png'), 'broken.png');
    // The content isn't an image, so the name decides the type.
    const res = await createJob(fileId, 'webp');
    const job = await waitForJob((res.json() as { job: JobDto }).job.id, 'error');
    expect(job.error?.messageKey).toBe('errors.convertFailed');
    const result = await app.inject({ url: `/api/jobs/${job.id}/result`, headers: { cookie } });
    expect(result.statusCode).toBe(410);
  });

  it("keeps other users' files and jobs private", async () => {
    const fileId = await tusUpload(app, cookie, png, 'a.png');
    const jobId = ((await createJob(fileId, 'webp')).json() as { job: JobDto }).job.id;
    await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { username: 'bea', password: 'a long password' },
    });
    const bea = sessionCookie(
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'bea', password: 'a long password' },
      }),
    );
    expect((await createJob(fileId, 'webp', {}, bea)).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `/api/jobs/${jobId}`, headers: { cookie: bea } })).statusCode,
    ).toBe(404);
    const list = await app.inject({ url: '/api/jobs', headers: { cookie: bea } });
    expect((list.json() as { jobs: unknown[] }).jobs).toEqual([]);
  });

  it('pushes progress over the WebSocket to the owner only', async () => {
    const ws = await app.injectWS('/api/ws', { headers: { cookie } });
    const messages: unknown[] = [];
    ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString())));
    const fileId = await tusUpload(app, cookie, png, 'a.png');
    const jobId = ((await createJob(fileId, 'avif')).json() as { job: JobDto }).job.id;
    await waitForJob(jobId, 'done');
    await vi.waitFor(() => {
      const parsed = messages.map((m) => wsServerMessageSchema.parse(m));
      expect(
        parsed.some((m) => m.type === 'job' && m.job.id === jobId && m.job.status === 'done'),
      ).toBe(true);
    });
    ws.terminate();
  });

  it('refuses WebSocket connections without sign-in', async () => {
    await expect(app.injectWS('/api/ws')).rejects.toThrow();
  });
});

describe('cancelling', () => {
  it('stops a running job', async () => {
    let started = false;
    const slow: Engine = {
      ...sharpEngine,
      id: 'slow',
      priority: 99,
      convert: (req) =>
        new Promise((_resolve, reject) => {
          started = true;
          req.signal?.addEventListener('abort', () => reject(abortError()));
        }),
    };
    await start({ engines: [slow] });
    const fileId = await tusUpload(app, cookie, png, 'a.png');
    const jobId = ((await createJob(fileId, 'webp')).json() as { job: JobDto }).job.id;
    await vi.waitFor(() => expect(started).toBe(true));
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/jobs/${jobId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    await waitForJob(jobId, 'cancelled');
  });
});

describe('after a restart', () => {
  const collect = (ids: string[]) => (): JobQueue => ({
    enqueue: async (id) => void ids.push(id),
    removeWaiting: async () => false,
    isHealthy: () => true,
    close: async () => undefined,
  });
  const userId = () =>
    (app.conbert.db.$client.prepare('select id from users').get() as { id: string }).id;

  it('queues conversions that were running or waiting again', async () => {
    const queued: string[] = [];
    await start({ queue: collect(queued) });
    const row = (id: string, status: 'running' | 'queued' | 'done') => ({
      id,
      userId: userId(),
      inputExt: 'png',
      outputExt: 'webp',
      steps: [],
      options: {},
      status,
      progress: 40,
    });
    app.conbert.db
      .insert(jobs)
      .values([row('a', 'running'), row('b', 'queued'), row('c', 'done')])
      .run();
    await resumeJobs(app.conbert);
    expect(queued.sort()).toEqual(['a', 'b']);
    const a = app.conbert.db.$client
      .prepare("select status, progress from jobs where id = 'a'")
      .get() as { status: string; progress: number };
    expect(a).toEqual({ status: 'queued', progress: 0 });
  });

  it('goes on with the workflow files that were not finished', async () => {
    const queued: string[] = [];
    await start({ workflowQueue: collect(queued) });
    app.conbert.db
      .insert(workflowRuns)
      .values({
        id: 'w',
        userId: userId(),
        name: 'Test',
        steps: [],
        fileIds: ['gone-1', 'gone-2'],
        status: 'running',
        results: [
          {
            sourceName: 'a.png',
            status: 'done',
            resultFileId: null,
            resultName: null,
            resultSize: null,
            savedTo: [],
            wouldSaveTo: [],
          },
          {
            sourceName: 'b.png',
            status: 'pending',
            resultFileId: null,
            resultName: null,
            resultSize: null,
            savedTo: [],
            wouldSaveTo: [],
          },
        ],
      })
      .run();
    await resumeWorkflowRuns(app.conbert);
    expect(queued).toEqual(['w']);
    await app.conbert.workflows.runner.run('w');
    const run = app.conbert.workflows.runner.row('w');
    expect(run?.status).toBe('done');
    const results = run?.results as { status: string }[];
    // The finished file stays as it was; the other one is processed now.
    expect(results.map((r) => r.status)).toEqual(['done', 'error']);
  });
});

describe('without a job queue', () => {
  const downQueue = (): JobQueue => ({
    enqueue: async () => {
      throw new Error('down');
    },
    removeWaiting: async () => false,
    isHealthy: () => false,
    close: async () => undefined,
  });

  it('explains that server conversions are paused', async () => {
    await start({ queue: downQueue });
    const fileId = await tusUpload(app, cookie, png, 'a.png');
    const res = await createJob(fileId, 'webp');
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('QUEUE_UNAVAILABLE');

    const engines = await app.inject({ url: '/api/engines', headers: { cookie } });
    for (const e of (engines.json() as { engines: { status: string }[] }).engines) {
      expect(e.status).toBe('error');
    }
    const health = await app.inject({ url: '/api/health' });
    expect(health.json()).toMatchObject({ queue: 'unavailable' });
  });
});

describe('contentDisposition', () => {
  it('keeps umlauts and neutralizes quotes', () => {
    expect(contentDisposition('Bild "1".png')).toBe(
      'attachment; filename="Bild _1_.png"; filename*=UTF-8\'\'Bild%20%221%22.png',
    );
    expect(contentDisposition('Über.webp')).toContain('filename="_ber.webp"');
  });
});

describe('OCR jobs', () => {
  // Stands in for ocrmypdf: hands the PDF back unchanged.
  const fakeOcr: Engine = {
    id: 'ocrmypdf',
    name: 'OCR',
    descriptionKey: 'engines.ocrmypdf.description',
    category: 'pdf',
    runtime: 'server',
    formats: [{ ext: 'pdf', canRead: true, canWrite: true }],
    options: [],
    supportsCompression: false,
    priority: 1,
    init: () => Promise.resolve(),
    status: () => 'ready',
    convert: async (req) => {
      const dir = req.workDir ?? os.tmpdir();
      await mkdir(dir, { recursive: true });
      const out = path.join(dir, 'ocr-result.pdf');
      await copyFile(String(req.input), out);
      return out;
    },
  };
  const pdf = readFileSync(path.join(import.meta.dirname, '../__fixtures__/sample.pdf'));

  beforeEach(() => start({ engines: [sharpEngine, fakeOcr] }));

  it('runs PDFs through the OCR engine only when asked to', async () => {
    const fileId = await tusUpload(app, cookie, pdf, 'scan.pdf');
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { cookie },
      payload: { fileId, outputExt: 'pdf', options: { ocrLanguage: 'deu' }, mode: 'ocr' },
    });
    expect(res.statusCode).toBe(201);
    const created = jobSchema.parse((res.json() as { job: unknown }).job);
    expect(created.steps).toEqual([{ engineId: 'ocrmypdf', from: 'pdf', to: 'pdf' }]);
    await waitForJob(created.id, 'done');

    // A normal PDF → PDF conversion never ends up there.
    const plain = await createJob(fileId, 'pdf');
    expect(plain.statusCode).toBe(422);
  });

  it('refuses OCR for files that are not PDFs', async () => {
    const fileId = await tusUpload(app, cookie, png, 'photo.png');
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { cookie },
      payload: { fileId, outputExt: 'pdf', mode: 'ocr' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('AI work on pictures', () => {
  // Stands in for the AI engine: hands the picture back as PNG.
  const fakeAi: Engine = {
    id: 'image-ai',
    name: 'AI',
    descriptionKey: 'engines.imageAi.description',
    category: 'image',
    runtime: 'server',
    formats: [{ ext: 'png', canRead: true, canWrite: false }],
    options: [],
    supportsCompression: false,
    priority: 1,
    init: () => Promise.resolve(),
    status: () => 'ready',
    convert: async (req) => {
      seenOptions.push(req.options);
      const dir = req.workDir ?? os.tmpdir();
      await mkdir(dir, { recursive: true });
      const out = path.join(dir, 'ai.png');
      await copyFile(String(req.input), out);
      return out;
    },
  };
  const seenOptions: Record<string, unknown>[] = [];

  beforeEach(() => {
    seenOptions.length = 0;
    return start({ engines: [sharpEngine, fakeAi] });
  });

  it('puts the AI step first, with the options, then converts as usual', async () => {
    const fileId = await tusUpload(app, cookie, png, 'portrait.png');
    const res = await createJob(fileId, 'webp', { removeBackground: true, quality: 70 });
    expect(res.statusCode, res.body).toBe(201);
    const created = jobSchema.parse((res.json() as { job: unknown }).job);
    expect(created.steps).toEqual([
      { engineId: 'image-ai', from: 'png', to: 'png', withOptions: true },
      { engineId: 'sharp', from: 'png', to: 'webp' },
    ]);
    await waitForJob(created.id, 'done');
    expect(seenOptions[0]).toMatchObject({ removeBackground: true });

    // PNG wanted: the AI step alone.
    const alone = jobSchema.parse(
      ((await createJob(fileId, 'png', { upscale: 2 })).json() as { job: unknown }).job,
    );
    expect(alone.steps).toEqual([
      { engineId: 'image-ai', from: 'png', to: 'png', withOptions: true },
    ]);
  });
});

describe('extra files for options of type "file"', () => {
  let seen: Record<string, string> | undefined;
  const withFile: Engine = {
    id: 'with-file',
    name: 'With file',
    descriptionKey: 'engines.fake.description',
    category: 'image',
    runtime: 'server',
    formats: [
      { ext: 'png', canRead: true, canWrite: false },
      { ext: 'bmp', canRead: false, canWrite: true },
    ],
    options: [
      {
        key: 'extra',
        labelKey: 'options.burnSubtitleFile.label',
        helpKey: 'options.burnSubtitleFile.help',
        advanced: true,
        type: 'file',
        default: null,
        accept: ['srt'],
      },
    ],
    supportsCompression: false,
    priority: 100,
    init: () => Promise.resolve(),
    status: () => 'ready',
    async convert(req) {
      seen = req.attachments;
      const out = path.join(req.workDir ?? '', 'out.bmp');
      await mkdir(req.workDir ?? '', { recursive: true });
      await copyFile(String(req.input), out);
      return out;
    },
  };
  const srt = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHallo\n');

  beforeEach(async () => {
    seen = undefined;
    await start({ engines: [sharpEngine, withFile] });
  });

  const post = (payload: object, as = cookie) =>
    app.inject({ method: 'POST', url: '/api/jobs', headers: { cookie: as }, payload });

  it('hands the engine the checked path, never one from the options', async () => {
    const fileId = await tusUpload(app, cookie, png, 'bild.png');
    const extra = await tusUpload(app, cookie, srt, 'film.srt');
    const res = await post({
      fileId,
      outputExt: 'bmp',
      options: { extra: '/etc/passwd' },
      attachments: { extra },
    });
    expect(res.statusCode, res.body).toBe(201);
    await waitForJob(jobSchema.parse((res.json() as { job: unknown }).job).id, 'done');
    expect(seen?.['extra']).toContain(extra);
    expect(seen?.['extra']).not.toBe('/etc/passwd');
  });

  it('refuses unknown options, wrong endings and other people’s files', async () => {
    const fileId = await tusUpload(app, cookie, png, 'bild.png');
    const picture = await tusUpload(app, cookie, png, 'kein-untertitel.png');
    expect(
      (await post({ fileId, outputExt: 'bmp', attachments: { other: picture } })).statusCode,
    ).toBe(400);
    const wrong = await post({ fileId, outputExt: 'bmp', attachments: { extra: picture } });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toMatchObject({ error: { code: 'ATTACHMENT_INVALID' } });

    // Someone else's subtitles are not found at all.
    const create = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { username: 'bea', password: 'ein langes passwort' },
    });
    expect(create.statusCode, create.body).toBe(201);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'bea', password: 'ein langes passwort' },
    });
    const bea = sessionCookie(login);
    const theirs = await tusUpload(app, bea, srt, 'film.srt');
    expect(
      (await post({ fileId, outputExt: 'bmp', attachments: { extra: theirs } })).statusCode,
    ).toBe(404);
  });
});
