import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineDescriptor } from '@conbert/core';
import type * as UseEngines from '@/engines/use-engines';
import { renderWithProviders } from '@/test/render';
import { DEFAULT_COMPRESS, useFiles, type FileItem } from './files-store';
import { TrimSection } from './TrimSection';

const ffmpeg: EngineDescriptor = {
  id: 'ffmpeg-wasm',
  name: 'FFmpeg',
  descriptionKey: 'engines.ffmpegWasm.description',
  category: 'video',
  runtime: 'browser',
  formats: ['mp4', 'webm', 'gif'].map((ext) => ({ ext, canRead: true, canWrite: true })),
  options: [],
  supportsCompression: true,
  supportsTrim: true,
  priority: 5,
  status: 'ready',
};

vi.mock('@/engines/use-engines', async (importOriginal) => {
  const original = await importOriginal<typeof UseEngines>();
  return {
    ...original,
    useAvailableEngines: () => ({ engines: [ffmpeg], serverAvailable: false }),
  };
});

function addVideo(): FileItem {
  const item: FileItem = {
    id: 'v1',
    file: new File(['x'], 'clip.mp4'),
    name: 'clip.mp4',
    task: 'convert',
    compress: DEFAULT_COMPRESS,
    ext: 'mp4',
    extMismatch: false,
    nameExt: 'mp4',
    previewUrl: null,
    targetExt: null,
    mode: 'local',
    options: {},
    status: 'idle',
    progress: 0,
  };
  useFiles.setState({ files: [item] });
  return item;
}

const current = () => useFiles.getState().files[0];
function video(): FileItem {
  const item = current();
  if (!item) throw new Error('no file in the list');
  return item;
}
const targets = [
  { ext: 'mp4', runtimes: ['browser' as const], steps: 1 },
  { ext: 'gif', runtimes: ['browser' as const], steps: 1 },
];

describe('TrimSection', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:clip');
    URL.revokeObjectURL = vi.fn();
  });

  it('keeps a part typed as times and picks the own format as target', async () => {
    addVideo();
    renderWithProviders(<TrimSection item={video()} targets={targets} />);
    await userEvent.click(screen.getByRole('button', { name: /Schneiden/ }));
    await userEvent.clear(screen.getByLabelText('Anfang'));
    await userEvent.type(screen.getByLabelText('Anfang'), '0:05{enter}');
    await userEvent.type(screen.getByLabelText('Ende'), '12,5{enter}');
    expect(current()?.options).toEqual({ trimStart: 5, trimEnd: 12.5 });
    await waitFor(() => expect(current()?.targetExt).toBe('mp4'));
    expect(current()?.options).toEqual({ trimStart: 5, trimEnd: 12.5 });
    expect(screen.getByTestId('trim-summary')).toHaveTextContent('0:05 – 0:12.5');

    // Same format: cutting fast is possible.
    await userEvent.click(screen.getByLabelText('Schnell schneiden (ohne Neukodierung)'));
    expect(current()?.options['trimFast']).toBe(true);
  });

  it('explains wrong times and removes the cut again', async () => {
    addVideo();
    useFiles.getState().setTrim('v1', { start: 3, end: null, fast: false });
    renderWithProviders(<TrimSection item={video()} targets={targets} />);
    await userEvent.click(screen.getByRole('button', { name: /Schneiden/ }));
    await userEvent.type(screen.getByLabelText('Ende'), '1:75{enter}');
    expect(screen.getByText(/keine gültige Zeit/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Schnitt entfernen/ }));
    expect(current()?.options).toEqual({});
  });

  it('keeps the cut when another target is chosen', () => {
    addVideo();
    useFiles.getState().setTrim('v1', { start: 1, end: 4, fast: true });
    useFiles.getState().setOption('v1', 'videoQuality', 'small');
    useFiles.getState().setTarget('v1', 'gif');
    expect(current()?.options).toEqual({ trimStart: 1, trimEnd: 4, trimFast: true });
  });
});
