import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversionError, type EngineDescriptor } from '@conbert/core';
import { DEFAULT_COMPRESS, useFiles, type FileItem } from './files-store';
import { runConversion } from './run-conversion';

const convertOnServer = vi.fn();
vi.mock('@/engines/server-convert', () => ({
  convertOnServer: (req: unknown) => convertOnServer(req),
  forgetUpload: () => undefined,
}));
vi.mock('@/engines/registry', () => ({ getBrowserEngine: () => undefined }));

const sharp: EngineDescriptor = {
  id: 'sharp',
  name: 'sharp',
  descriptionKey: 'engines.sharp.description',
  category: 'image',
  runtime: 'server',
  formats: ['png', 'webp'].map((ext) => ({ ext, canRead: true, canWrite: true })),
  options: [],
  supportsCompression: true,
  priority: 20,
  status: 'ready',
};

function addItem(): FileItem {
  const item: FileItem = {
    id: crypto.randomUUID(),
    file: new File(['x'], 'urlaub.png'),
    ext: 'png',
    extMismatch: false,
    name: 'urlaub.png',
    task: 'convert',
    compress: DEFAULT_COMPRESS,
    nameExt: 'png',
    previewUrl: null,
    targetExt: 'webp',
    mode: 'server',
    options: { quality: 55 },
    status: 'idle',
    progress: 0,
  };
  useFiles.setState({ files: [item] });
  return item;
}

describe('server conversions', () => {
  beforeEach(() => {
    convertOnServer.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:server');
    URL.revokeObjectURL = vi.fn();
  });

  it('hands the whole conversion to the server with the user options', async () => {
    convertOnServer.mockImplementation(async (req: { onProgress: (p: unknown) => void }) => {
      req.onProgress({ percent: 20, stage: 'uploading' });
      return new Blob(['webp'], { type: 'image/webp' });
    });
    const item = addItem();
    await runConversion(item, [sharp], { serverAvailable: true });
    expect(convertOnServer).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'urlaub.png',
        outputExt: 'webp',
        options: { quality: 55 },
      }),
    );
    expect(useFiles.getState().files[0]).toMatchObject({
      status: 'done',
      result: { fileName: 'urlaub.webp', ext: 'webp' },
    });
  });

  it('shows server errors with their translatable key', async () => {
    convertOnServer.mockRejectedValue(new ConversionError('errors.fileTooLarge', '413'));
    const item = addItem();
    await runConversion(item, [sharp], { serverAvailable: true });
    expect(useFiles.getState().files[0]).toMatchObject({
      status: 'error',
      error: { messageKey: 'errors.fileTooLarge', details: '413' },
    });
  });

  it('does not use the server when it is unavailable', async () => {
    const item = addItem();
    await runConversion(item, [sharp], { serverAvailable: false });
    expect(convertOnServer).not.toHaveBeenCalled();
    expect(useFiles.getState().files[0]?.error?.messageKey).toBe('errors.noRoute');
  });
});
