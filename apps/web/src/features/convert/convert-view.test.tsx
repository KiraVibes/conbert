import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineDescriptor } from '@conbert/core';
import type * as UseEngines from '@/engines/use-engines';
import { renderWithProviders } from '@/test/render';
import { useSettings } from '@/features/settings/settings-store';
import { ConvertView } from './ConvertView';
import { useFiles } from './files-store';

const fakeEngine: EngineDescriptor = {
  id: 'fake-image',
  name: 'Fake',
  descriptionKey: 'engines.libvips.description',
  category: 'image',
  runtime: 'browser',
  formats: ['png', 'jpg', 'webp', 'gif'].map((ext) => ({ ext, canRead: true, canWrite: true })),
  options: [],
  supportsCompression: true,
  priority: 10,
  status: 'uninitialized',
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
const pngFile = (name = 'pixel.png') =>
  new File([Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0))], name);

describe('ConvertView', () => {
  beforeEach(() => {
    useFiles.getState().clear();
    useSettings.getState().reset();
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  it('shows the dropzone and adds chosen files as cards', async () => {
    renderWithProviders(<ConvertView />);
    expect(screen.getByText('Dateien hierher ziehen')).toBeInTheDocument();

    await userEvent.upload(screen.getByTestId('file-input'), [pngFile(), pngFile('b.png')]);

    expect(await screen.findAllByTestId('file-card')).toHaveLength(2);
    await waitFor(() => expect(screen.getAllByText(/PNG-Bild/)).toHaveLength(2));
    expect(screen.getByText('2 Dateien')).toBeInTheDocument();
  });

  it('new files use the default mode from the settings', async () => {
    useSettings.getState().setDefaultMode('local');
    renderWithProviders(<ConvertView />);
    await userEvent.upload(screen.getByTestId('file-input'), pngFile());
    await waitFor(() => expect(useFiles.getState().files[0]?.mode).toBe('local'));
  });

  it('explains the chosen route and warns about lost transparency', async () => {
    renderWithProviders(<ConvertView />);
    await userEvent.upload(screen.getByTestId('file-input'), pngFile());
    await waitFor(() => expect(useFiles.getState().files[0]?.status).toBe('idle'));

    const id = useFiles.getState().files[0]?.id ?? '';
    act(() => useFiles.getState().setTarget(id, 'jpg'));

    expect(await screen.findByText(/kann keine Transparenz/)).toBeInTheDocument();
    expect(screen.getByText(/Details weglässt/)).toBeInTheDocument();
    expect(screen.getByText(/am privatesten/)).toBeInTheDocument();
  });

  it('tells the user when a file type cannot be converted', async () => {
    renderWithProviders(<ConvertView />);
    await userEvent.upload(screen.getByTestId('file-input'), new File(['hello'], 'notes.xyz'));
    expect(await screen.findByText(/keine Umwandlung/)).toBeInTheDocument();
  });

  it('removes a file and frees its preview', async () => {
    renderWithProviders(<ConvertView />);
    await userEvent.upload(screen.getByTestId('file-input'), pngFile());
    await waitFor(() => expect(useFiles.getState().files[0]?.status).toBe('idle'));
    await userEvent.click(screen.getByRole('button', { name: '„pixel.png“ entfernen' }));
    expect(screen.queryByTestId('file-card')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });
});

describe('purpose assistant', () => {
  beforeEach(async () => {
    useFiles.getState().clear();
    useFiles.getState().clear('compress');
    useSettings.getState().reset();
    const { usePurpose } = await import('./purpose-store');
    usePurpose.setState({ purpose: null });
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  it('sets format and quality for WhatsApp and explains why', async () => {
    renderWithProviders(<ConvertView />);
    await userEvent.upload(screen.getByTestId('file-input'), pngFile());
    await waitFor(() => expect(useFiles.getState().files[0]?.status).toBe('idle'));

    await userEvent.click(screen.getByRole('button', { name: /Wofür brauchst du die Datei/ }));
    await userEvent.click(screen.getByRole('button', { name: /Für WhatsApp/ }));

    await waitFor(() => expect(useFiles.getState().files[0]?.targetExt).toBe('jpg'));
    expect(useFiles.getState().files[0]?.options).toMatchObject({ quality: 80 });
    expect(screen.getByText(/JPG öffnet jedes Handy/)).toBeInTheDocument();
  });

  it('also applies to files added afterwards and keeps hand-made changes', async () => {
    renderWithProviders(<ConvertView />);
    await userEvent.click(screen.getByRole('button', { name: /Wofür brauchst du die Datei/ }));
    await userEvent.click(screen.getByRole('button', { name: /Auf einer Webseite/ }));
    await userEvent.upload(screen.getByTestId('file-input'), pngFile());
    await waitFor(() => expect(useFiles.getState().files[0]?.targetExt).toBe('webp'));

    const id = useFiles.getState().files[0]?.id ?? '';
    act(() => useFiles.getState().setTarget(id, 'gif'));
    await new Promise((r) => setTimeout(r, 20));
    expect(useFiles.getState().files[0]?.targetExt).toBe('gif');
    expect(useFiles.getState().files[0]?.purpose).toBeUndefined();
  });

  it('moves files to the compress tab when size is what counts', async () => {
    renderWithProviders(<ConvertView />);
    await userEvent.upload(screen.getByTestId('file-input'), pngFile());
    await waitFor(() => expect(useFiles.getState().files[0]?.status).toBe('idle'));
    await userEvent.click(screen.getByRole('button', { name: /Wofür brauchst du die Datei/ }));
    await userEvent.click(screen.getByRole('button', { name: /Platz sparen/ }));
    await waitFor(() => expect(useFiles.getState().files[0]?.task).toBe('compress'));
    expect(useFiles.getState().files[0]?.compress.level).toBe('balanced');
  });
});

describe('purpose assistant – folded', () => {
  it('starts folded, opens on click and shows a chosen purpose when folded', async () => {
    const { usePurpose } = await import('./purpose-store');
    usePurpose.setState({ purpose: null });
    renderWithProviders(<ConvertView />);
    const toggle = screen.getByRole('button', { name: /Wofür brauchst du die Datei/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Für WhatsApp/ })).not.toBeInTheDocument();
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('button', { name: /Für WhatsApp/ }));
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent(/WhatsApp/);
  });
});
