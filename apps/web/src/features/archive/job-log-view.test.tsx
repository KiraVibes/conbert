import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineDescriptor } from '@conbert/core';
import type * as UseEngines from '@/engines/use-engines';
import { renderWithProviders } from '@/test/render';
import { DEFAULT_COMPRESS, useFiles, type FileItem } from '@/features/convert/files-store';
import { JobLogView } from './JobLogView';
import { recordJob, useJobLog } from './job-log';

const fakeEngine: EngineDescriptor = {
  id: 'fake-image',
  name: 'Fake',
  descriptionKey: 'engines.libvips.description',
  category: 'image',
  runtime: 'browser',
  formats: ['png', 'webp'].map((ext) => ({ ext, canRead: true, canWrite: true })),
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
  supportsCompression: true,
  priority: 10,
  status: 'ready',
};

vi.mock('@/engines/use-engines', async (importOriginal) => {
  const original = await importOriginal<typeof UseEngines>();
  return {
    ...original,
    useAvailableEngines: () => ({ engines: [fakeEngine], serverAvailable: false }),
  };
});

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const pngFile = (name: string) =>
  new File([Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0))], name);

function finishedItem(file: File, patch: Partial<FileItem> = {}): FileItem {
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    task: 'convert',
    compress: DEFAULT_COMPRESS,
    ext: 'png',
    extMismatch: false,
    nameExt: 'png',
    previewUrl: null,
    targetExt: 'webp',
    mode: 'local',
    options: { quality: 42 },
    status: 'done',
    progress: 100,
    ...patch,
  };
}

describe('JobLogView', () => {
  beforeEach(() => {
    useFiles.getState().reset();
    useJobLog.getState().clear();
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    window.location.hash = '#/archive';
  });

  it('shows each job with its settings in plain words', async () => {
    recordJob(finishedItem(pngFile('holiday.png')), {
      runtime: 'browser',
      engineIds: ['fake-image'],
      options: { quality: 42 },
      startedAt: Date.now() - 1500,
      resultSize: 50,
    });
    renderWithProviders(<JobLogView />);
    expect(screen.getByText('holiday.png')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Einstellungen anzeigen'));
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Auf diesem Gerät')).toBeInTheDocument();
    expect(screen.getByText('Fake')).toBeInTheDocument();
  });

  it('runs a job of this visit again with the same file and settings', async () => {
    recordJob(finishedItem(pngFile('again.png')), {
      runtime: 'browser',
      engineIds: ['fake-image'],
      options: { quality: 42 },
      startedAt: Date.now(),
    });
    renderWithProviders(<JobLogView />);
    await userEvent.click(screen.getByRole('button', { name: /Nochmal/ }));
    await waitFor(() =>
      expect(useFiles.getState().files[0]).toMatchObject({
        name: 'again.png',
        status: 'idle',
        targetExt: 'webp',
        mode: 'local',
        options: { quality: 42 },
      }),
    );
    // Back on the convert page, where the file is waiting.
    expect(window.location.hash).toBe('');
  });

  it('applies the settings to other files, also in the compress tab', async () => {
    recordJob(
      finishedItem(pngFile('small.png'), {
        task: 'compress',
        targetExt: 'png',
        options: {},
        compress: { level: 'target', targetMb: 2, stripMetadata: false },
      }),
      { options: {}, startedAt: Date.now(), error: 'errors.convertFailed' },
    );
    renderWithProviders(<JobLogView />);
    expect(screen.getByText('Die Datei konnte nicht umgewandelt werden.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Mit anderer Datei/ }));
    await userEvent.upload(screen.getByTestId('history-file-input'), [
      pngFile('a.png'),
      pngFile('b.png'),
    ]);
    await waitFor(() =>
      expect(useFiles.getState().files.every((f) => f.status === 'idle')).toBe(true),
    );
    expect(useFiles.getState().files.map((f) => [f.name, f.task, f.compress.targetMb])).toEqual([
      ['a.png', 'compress', 2],
      ['b.png', 'compress', 2],
    ]);
    expect(window.location.hash).toBe('#/compress');
  });
});
