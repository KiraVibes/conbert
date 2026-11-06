import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Api from '@/lib/api';
import { ApiRequestError, apiPost } from '@/lib/api';
import { saveToTargets } from '@/features/storage/storage-api';
import { convertOnServer, rememberServerFile, serverJobOf } from './server-convert';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof Api>()),
  apiPost: vi.fn(),
}));
vi.mock('@/lib/job-socket', () => ({ subscribeToJob: () => () => undefined }));

/** tus: every new upload gets the next id. */
const uploaded: string[] = [];
vi.mock('tus-js-client', () => ({
  DetailedError: class extends Error {},
  Upload: class {
    url: string | null = null;
    constructor(
      _file: Blob,
      private readonly options: { onSuccess: () => void },
    ) {}
    findPreviousUploads() {
      return Promise.resolve([]);
    }
    start() {
      const id = `upload-${uploaded.length + 1}`;
      uploaded.push(id);
      this.url = `/api/upload/${id}`;
      this.options.onSuccess();
    }
    abort() {
      return Promise.resolve();
    }
  },
}));

const post = vi.mocked(apiPost);

function doneJob(id: string) {
  return {
    job: {
      id,
      status: 'done',
      progress: 100,
      inputExt: 'png',
      outputExt: 'webp',
      createdAt: new Date().toISOString(),
    },
  };
}

const saved = [{ targetId: 't1', status: 'saved', path: 'Bild.webp', error: null }];

beforeEach(() => {
  uploaded.length = 0;
  post.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(new Blob(['webp'])))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('server results and storage locations', () => {
  it('copies a server result on the server instead of uploading it again', async () => {
    post.mockResolvedValueOnce(doneJob('job-1'));
    const result = await convertOnServer({
      file: new File(['png'], 'Bild.png'),
      fileName: 'Bild.png',
      outputExt: 'webp',
      options: {},
    });
    expect(serverJobOf(result)).toBe('job-1');
    expect(uploaded).toHaveLength(1);

    post.mockResolvedValueOnce({ results: saved });
    const progress = vi.fn();
    await expect(saveToTargets(result, 'Bild.webp', ['t1'], 'Fotos', progress)).resolves.toEqual(
      saved,
    );
    expect(post).toHaveBeenLastCalledWith(
      '/api/jobs/job-1/export',
      { targetIds: ['t1'], name: 'Bild.webp', folder: 'Fotos', category: 'image' },
      expect.anything(),
    );
    expect(progress).toHaveBeenCalledWith(1);
    expect(uploaded).toHaveLength(1);
  });

  it('uploads the result after all when the server tidied it away', async () => {
    post.mockResolvedValueOnce(doneJob('job-2'));
    const result = await convertOnServer({
      file: new File(['png'], 'Bild.png'),
      fileName: 'Bild.png',
      outputExt: 'webp',
      options: {},
    });
    post
      .mockRejectedValueOnce(new ApiRequestError(410, 'errors.resultGone'))
      .mockResolvedValueOnce({ results: saved });
    await saveToTargets(result, 'Bild.webp', ['t1'], undefined);
    expect(uploaded).toHaveLength(2);
    expect(post).toHaveBeenLastCalledWith(
      '/api/files/upload-2/export',
      expect.objectContaining({ name: 'Bild.webp' }),
      expect.anything(),
    );
  });

  it('converts a file from a storage location without uploading it', async () => {
    const file = new File(['png'], 'Vom-NAS.png');
    rememberServerFile(file, 'imported-1');
    post.mockResolvedValueOnce(doneJob('job-3'));
    await convertOnServer({ file, fileName: file.name, outputExt: 'webp', options: {} });
    expect(post).toHaveBeenCalledWith(
      '/api/jobs',
      expect.objectContaining({ fileId: 'imported-1' }),
      expect.anything(),
    );
    expect(uploaded).toHaveLength(0);
  });

  it('uploads once more when the remembered file is gone on the server', async () => {
    const file = new File(['png'], 'Vom-NAS.png');
    rememberServerFile(file, 'imported-old');
    post
      .mockRejectedValueOnce(new ApiRequestError(404, 'errors.notFound'))
      .mockResolvedValueOnce(doneJob('job-4'));
    const result = await convertOnServer({
      file,
      fileName: file.name,
      outputExt: 'webp',
      options: {},
    });
    expect(uploaded).toEqual(['upload-1']);
    expect(post).toHaveBeenLastCalledWith(
      '/api/jobs',
      expect.objectContaining({ fileId: 'upload-1' }),
      expect.anything(),
    );
    expect(serverJobOf(result)).toBe('job-4');
  });
});

describe('extra files chosen in options', () => {
  it('uploads them first and sends them as attachments, not as options', async () => {
    post.mockResolvedValueOnce(doneJob('job-5'));
    const subtitles = new File(['1\n00:00:01,000 --> 00:00:02,000\nHallo\n'], 'Film.srt');
    await convertOnServer({
      file: new File(['mkv'], 'Film.mkv'),
      fileName: 'Film.mkv',
      outputExt: 'mp4',
      options: { burnSubtitleFile: subtitles, videoQuality: 'high' },
    });
    expect(uploaded).toEqual(['upload-1', 'upload-2']);
    expect(post).toHaveBeenCalledWith(
      '/api/jobs',
      expect.objectContaining({
        options: { videoQuality: 'high' },
        attachments: { burnSubtitleFile: 'upload-1' },
        fileId: 'upload-2',
      }),
      expect.anything(),
    );
  });
});
