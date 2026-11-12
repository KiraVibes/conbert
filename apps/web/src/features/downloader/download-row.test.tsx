import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { downloadSchema } from '@conbert/schemas';
import { renderWithProviders } from '@/test/render';
import { DownloadRow } from './DownloaderView';

const download = (keepOnServer: boolean, files: { fileId: string; onServer?: boolean }[]) =>
  downloadSchema.parse({
    id: 'd1',
    url: 'https://www.instagram.com/p/abc/',
    platform: 'instagram',
    title: 'Post',
    status: 'done',
    progress: 100,
    current: null,
    toList: false,
    keepOnServer,
    done: files.length,
    total: files.length,
    files: files.map((f) => ({ name: `${f.fileId}.mp4`, ext: 'mp4', size: 1000, ...f })),
    skipped: 0,
    savedTo: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });

describe('download card', () => {
  it('offers each file still on the server for download, and a ZIP of the archived ones', () => {
    renderWithProviders(
      <DownloadRow
        download={download(true, [{ fileId: 'a' }, { fileId: 'b' }])}
        onTake={() => {}}
      />,
    );
    const link = screen.getByRole('link', { name: '„a.mp4“ herunterladen' });
    expect(link).toHaveAttribute('href', '/api/files/a/content');
    expect(link).toHaveAttribute('download', 'a.mp4');
    expect(screen.getByTestId('time-stamp')).toHaveTextContent('Heruntergeladen:');
    expect(screen.getByRole('link', { name: /ZIP/ })).toHaveAttribute(
      'href',
      '/api/archive/zip?ids=a,b',
    );
  });

  it('has no button for files that are only at a storage location', () => {
    renderWithProviders(
      <DownloadRow
        download={download(false, [{ fileId: 'a', onServer: false }])}
        onTake={() => {}}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
