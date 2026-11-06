import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversionError, describeEngine, type Engine } from '@conbert/core';
import { DEFAULT_COMPRESS, useFiles, type FileItem } from './files-store';
import { runConversion } from './run-conversion';

const used: string[] = [];

function engine(id: string, priority: number, fail?: string): Engine {
  return {
    id,
    name: id,
    descriptionKey: 'engines.libvips.description',
    category: 'image',
    runtime: 'browser',
    formats: ['png', 'webp'].map((ext) => ({ ext, canRead: true, canWrite: true })),
    options: [],
    supportsCompression: false,
    priority,
    init: () => Promise.resolve(),
    status: () => 'ready',
    convert: async () => {
      used.push(id);
      if (fail) throw new ConversionError(fail);
      return new Blob(['ok']);
    },
  };
}

let engines: Record<string, Engine> = {};
vi.mock('@/engines/registry', () => ({ getBrowserEngine: (id: string) => engines[id] }));
vi.mock('@/engines/server-convert', () => ({
  convertOnServer: vi.fn(),
  forgetUpload: () => undefined,
}));

function addItem(): FileItem {
  const item: FileItem = {
    id: crypto.randomUUID(),
    file: new File(['x'], 'a.png'),
    ext: 'png',
    extMismatch: false,
    name: 'a.png',
    task: 'convert',
    compress: DEFAULT_COMPRESS,
    nameExt: 'png',
    previewUrl: null,
    targetExt: 'webp',
    mode: 'local',
    options: {},
    status: 'idle',
    progress: 0,
  };
  useFiles.setState({ files: [item] });
  return item;
}

describe('fallback to another engine', () => {
  beforeEach(() => {
    used.length = 0;
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });

  it('tries the next engine when the first can not handle the format right now', async () => {
    engines = {
      first: engine('first', 20, 'errors.formatUnavailable'),
      second: engine('second', 10),
    };
    await runConversion(addItem(), Object.values(engines).map(describeEngine), {
      serverAvailable: false,
    });
    expect(used).toEqual(['first', 'second']);
    expect(useFiles.getState().files[0]?.status).toBe('done');
  });

  it('does not retry real conversion errors (e.g. a broken file)', async () => {
    engines = { first: engine('first', 20, 'errors.convertFailed'), second: engine('second', 10) };
    await runConversion(addItem(), Object.values(engines).map(describeEngine), {
      serverAvailable: false,
    });
    expect(used).toEqual(['first']);
    expect(useFiles.getState().files[0]?.error?.messageKey).toBe('errors.convertFailed');
  });
});
