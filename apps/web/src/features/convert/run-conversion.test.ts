import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConversionError,
  abortError,
  describeEngine,
  type ConvertRequest,
  type Engine,
} from '@conbert/core';
import { DEFAULT_COMPRESS, useFiles, type FileItem } from './files-store';
import { outputFileName } from '@conbert/core';
import { useJobLog } from '@/features/archive/job-log';
import { cancelConversion, runAll, runConversion } from './run-conversion';

const calls: { from: string; to: string; options: Record<string, unknown> }[] = [];
let behaviour: 'ok' | 'fail' | 'slow' = 'ok';

function fakeEngine(id: string, pairs: [string, string][]): Engine {
  const exts = [...new Set(pairs.flat())];
  return {
    id,
    name: id,
    descriptionKey: 'engines.libvips.description',
    category: 'image',
    runtime: 'browser',
    formats: exts.map((ext) => ({
      ext,
      canRead: pairs.some(([f]) => f === ext),
      canWrite: pairs.some(([, t]) => t === ext),
    })),
    options: [
      {
        key: 'quality',
        labelKey: 'options.quality.label',
        helpKey: 'options.quality.help',
        advanced: false,
        type: 'number',
        default: 80,
      },
    ],
    supportsCompression: false,
    priority: 1,
    init: () => Promise.resolve(),
    status: () => 'ready',
    convert: async (req: ConvertRequest) => {
      calls.push({ from: req.inputExt, to: req.outputExt, options: req.options });
      req.onProgress?.({ percent: 50, stage: 'converting' });
      if (behaviour === 'fail') throw new ConversionError('errors.convertFailed', 'boom');
      if (behaviour === 'slow') {
        await new Promise((resolve, reject) => {
          req.signal?.addEventListener('abort', () => reject(abortError()));
          setTimeout(resolve, 1000);
        });
      }
      return new Blob([`${req.outputExt}`], { type: 'application/octet-stream' });
    },
  };
}

// a → b directly, b → c: so a → c is a two-step chain.
const engineAB = fakeEngine('ab', [['png', 'webp']]);
const engineBC = fakeEngine('bc', [['webp', 'gif']]);
// Re-encodes PNG in place (compress tab).
const enginePP = { ...fakeEngine('pp', [['png', 'png']]), supportsCompression: true };

vi.mock('@/engines/registry', () => ({
  getBrowserEngine: (id: string) => ({ ab: engineAB, bc: engineBC, pp: enginePP })[id],
}));

const engines = [describeEngine(engineAB), describeEngine(engineBC), describeEngine(enginePP)];
const ctx = { serverAvailable: false };

function addItem(targetExt: string, options: Record<string, unknown> = {}): FileItem {
  const item: FileItem = {
    id: crypto.randomUUID(),
    file: new File(['x'], 'photo.png'),
    ext: 'png',
    extMismatch: false,
    name: 'photo.png',
    task: 'convert',
    compress: DEFAULT_COMPRESS,
    nameExt: 'png',
    previewUrl: null,
    targetExt,
    mode: 'auto',
    options,
    status: 'idle',
    progress: 0,
  };
  useFiles.setState((s) => ({ files: [...s.files, item] }));
  return item;
}

const current = (id: string) => useFiles.getState().files.find((f) => f.id === id);

describe('runConversion', () => {
  beforeEach(() => {
    calls.length = 0;
    behaviour = 'ok';
    useFiles.setState({ files: [] });
    useJobLog.setState({ records: [] });
    URL.createObjectURL = vi.fn(() => 'blob:result');
    URL.revokeObjectURL = vi.fn();
  });

  it('converts directly and stores the result with a sensible file name', async () => {
    const item = addItem('webp', { quality: 42 });
    await runConversion(item, engines, ctx);
    // The last step also learns the file name (e.g. as an e-book title).
    expect(calls).toEqual([{ from: 'png', to: 'webp', options: { quality: 42, title: 'photo' } }]);
    expect(current(item.id)).toMatchObject({ status: 'done', progress: 100 });
    expect(current(item.id)?.result?.fileName).toBe('photo.webp');
  });

  it('runs chains step by step; only the last step gets the user options', async () => {
    const item = addItem('gif', { quality: 10 });
    await runConversion(item, engines, ctx);
    expect(calls).toEqual([
      { from: 'png', to: 'webp', options: { quality: 80 } },
      { from: 'webp', to: 'gif', options: { quality: 10, title: 'photo' } },
    ]);
    expect(current(item.id)?.status).toBe('done');
  });

  it('shows engine errors with their translatable key', async () => {
    behaviour = 'fail';
    const item = addItem('webp');
    await runConversion(item, engines, ctx);
    expect(current(item.id)).toMatchObject({
      status: 'error',
      error: { messageKey: 'errors.convertFailed', details: 'boom' },
    });
  });

  it('explains when there is no route', async () => {
    const item = addItem('tiff');
    await runConversion(item, engines, ctx);
    expect(current(item.id)?.error?.messageKey).toBe('errors.noRoute');
  });

  it('notes finished jobs with their settings in the history', async () => {
    const item = addItem('gif', { quality: 10 });
    await runConversion(item, engines, ctx);
    const [record] = useJobLog.getState().records;
    expect(record).toMatchObject({
      status: 'done',
      task: 'convert',
      sourceName: 'photo.png',
      sourceExt: 'png',
      targetExt: 'gif',
      mode: 'auto',
      runtime: 'browser',
      engineIds: ['ab', 'bc'],
      options: { quality: 10 },
      resultSize: 3,
    });
    expect(record?.compress).toBeUndefined();
  });

  it('notes failed jobs and missing routes in the history too', async () => {
    behaviour = 'fail';
    await runConversion(addItem('webp'), engines, ctx);
    await runConversion(addItem('tiff'), engines, ctx);
    const records = useJobLog.getState().records;
    expect(records.map((r) => [r.targetExt, r.status, r.errorKey]).sort()).toEqual([
      ['tiff', 'error', 'errors.noRoute'],
      ['webp', 'error', 'errors.convertFailed'],
    ]);
  });

  it('can be cancelled and goes back to idle', async () => {
    behaviour = 'slow';
    const item = addItem('webp');
    const running = runConversion(item, engines, ctx);
    await vi.waitFor(() => expect(current(item.id)?.status).toBe('converting'));
    cancelConversion(item.id);
    await running;
    expect(current(item.id)).toMatchObject({ status: 'idle', progress: 0 });
    // Cancelling is not a job worth remembering.
    expect(useJobLog.getState().records).toHaveLength(0);
  });

  it('runAll converts every pending file and skips finished ones', async () => {
    const a = addItem('webp');
    const b = addItem('webp');
    await runConversion(a, engines, ctx);
    calls.length = 0;
    await runAll(useFiles.getState().files, engines, ctx);
    expect(calls).toHaveLength(1);
    expect(current(b.id)?.status).toBe('done');
  });
});

describe('outputFileName', () => {
  it.each([
    ['photo.png', 'webp', 'photo.webp'],
    ['my.holiday.photo.JPG', 'avif', 'my.holiday.photo.avif'],
    ['README', 'txt', 'README.txt'],
    ['.hidden', 'png', '.hidden.png'],
  ])('%s → %s', (name, ext, expected) => {
    expect(outputFileName(name, ext)).toBe(expected);
  });
});

describe('compressing', () => {
  beforeEach(() => {
    calls.length = 0;
    behaviour = 'ok';
    useFiles.setState({ files: [] });
    URL.createObjectURL = vi.fn(() => 'blob:result');
    URL.revokeObjectURL = vi.fn();
  });

  function addCompressItem(content: string, targetExt: string): FileItem {
    const item = addItem(targetExt);
    const patched = { ...item, task: 'compress' as const, file: new File([content], 'photo.png') };
    useFiles.setState({ files: [patched] });
    return patched;
  }

  it('re-encodes in the same format with the level as options', async () => {
    const item = addCompressItem('a much longer original file', 'png');
    await runConversion(item, engines, ctx);
    expect(calls).toEqual([
      {
        from: 'png',
        to: 'png',
        options: expect.objectContaining({ forceReencode: true, effort: 'small' }),
      },
    ]);
    const result = current(item.id)?.result;
    expect(result?.keptOriginal).toBeUndefined();
    expect(result?.blob.size).toBe(3);
  });

  it('keeps the original when the result would be bigger', async () => {
    const item = addCompressItem('x', 'webp');
    await runConversion(item, engines, ctx);
    const result = current(item.id)?.result;
    expect(result?.keptOriginal).toBe(true);
    expect(result?.blob).toBe(item.file);
    expect(result?.ext).toBe('png');
    expect(result?.fileName).toBe('photo.png');
  });
});
