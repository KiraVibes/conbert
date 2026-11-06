import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineDescriptor } from '@conbert/core';
import { renderWithProviders } from '@/test/render';
import { DEFAULT_COMPRESS, useFiles, type FileItem } from './files-store';
import { ImageAiSection } from './ImageAiSection';
import { imageAiDecision, imageAiTargets } from './image-ai';

function addPicture(targetExt: string | null = null): FileItem {
  const item: FileItem = {
    id: 'p1',
    file: new File(['x'], 'cat.jpg'),
    name: 'cat.jpg',
    task: 'convert',
    compress: DEFAULT_COMPRESS,
    ext: 'jpg',
    extMismatch: false,
    nameExt: 'jpg',
    previewUrl: null,
    targetExt,
    mode: 'auto',
    options: {},
    status: 'idle',
    progress: 0,
  };
  useFiles.setState({ files: [item] });
  return item;
}
const current = () => useFiles.getState().files[0];
function picture(): FileItem {
  const item = current();
  if (!item) throw new Error('no picture');
  return item;
}

describe('ImageAiSection', () => {
  beforeEach(() => {
    URL.revokeObjectURL = vi.fn();
  });

  it('removes the background as PNG and upscales', async () => {
    addPicture();
    renderWithProviders(<ImageAiSection item={picture()} />);
    await userEvent.click(screen.getByRole('button', { name: /Verbessern/ }));
    await userEvent.click(screen.getByLabelText('Hintergrund entfernen'));
    expect(current()).toMatchObject({ targetExt: 'png', options: { removeBackground: true } });
    await userEvent.click(screen.getByRole('radio', { name: '4×' }));
    expect(current()?.options).toEqual({ removeBackground: true, upscale: 4 });
    expect(screen.getByText('Hintergrund wird entfernt · 4× größer')).toBeInTheDocument();

    // A new target keeps the AI choice.
    useFiles.getState().setTarget('p1', 'webp');
    expect(current()?.options).toEqual({ removeBackground: true, upscale: 4 });
    await userEvent.click(screen.getByRole('radio', { name: 'Aus' }));
    expect(current()?.options).toEqual({ removeBackground: true });
  });

  it('warns when the target can’t be transparent', async () => {
    addPicture('jpg');
    useFiles.getState().setImageAi('p1', { removeBackground: true });
    renderWithProviders(<ImageAiSection item={picture()} />);
    expect(screen.getByText(/kann nichts Durchsichtiges speichern/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'PNG verwenden' }));
    expect(current()?.targetExt).toBe('png');
  });
});

describe('route for AI work', () => {
  const engine = (id: string, runtime: 'browser' | 'server', exts: string[]): EngineDescriptor => ({
    id,
    name: id,
    descriptionKey: 'x',
    category: 'image',
    runtime,
    formats: exts.map((ext) => ({ ext, canRead: true, canWrite: id !== 'image-ai' })),
    options: [],
    supportsCompression: false,
    priority: 10,
    status: 'ready',
  });
  const engines = [
    engine('image-ai', 'server', ['jpg', 'png', 'webp']),
    engine('sharp', 'server', ['jpg', 'png', 'webp', 'avif']),
    engine('libvips', 'browser', ['jpg', 'png', 'webp']),
  ];

  it('always runs on the server, also into the own format', () => {
    expect(imageAiTargets(engines, 'jpg').map((t) => t.ext)).toEqual([
      'png',
      'jpg',
      'webp',
      'avif',
    ]);
    expect(imageAiDecision(engines, 'jpg', 'jpg', true)).toMatchObject({
      reason: 'modeServer',
      route: { runtime: 'server', steps: [{ engineId: 'image-ai', from: 'jpg', to: 'jpg' }] },
    });
    expect(imageAiDecision(engines, 'jpg', 'png', false)).toMatchObject({
      route: null,
      reason: 'serverUnavailable',
    });
    expect(imageAiDecision(engines, 'svg', 'png', true).route).toBeNull();
  });
});
