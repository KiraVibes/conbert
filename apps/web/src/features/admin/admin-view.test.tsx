import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminOverview } from '@conbert/schemas';
import type * as Api from '@/lib/api';
import { renderWithProviders } from '@/test/render';
import { AdminView } from './AdminView';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  apiGet: (...args: unknown[]) => api.get(...args),
  apiPut: (...args: unknown[]) => api.put(...args),
}));
const role = vi.hoisted(() => ({ value: 'admin' as 'admin' | 'user' }));
vi.mock('@/features/auth/use-auth', () => ({
  useCurrentUser: () => ({ id: 'a', username: 'admin', role: role.value }),
}));

const GB = 1024 ** 3;
const overview: AdminOverview = {
  system: {
    version: '0.1.0',
    node: 'v24.0.0',
    platform: 'linux x64',
    cpus: 4,
    load: [0.5, 0.4, 0.3],
    memTotal: 8 * GB,
    memFree: 2 * GB,
    processMemory: 0.5 * GB,
    uptimeSeconds: 7200,
  },
  disk: { path: '/data', total: 100 * GB, free: 1 * GB, uploads: 3 * GB, tmp: 0, models: 0.7 * GB },
  quotaDefault: 5 * GB,
  archiveKeepHours: 168,
  users: [
    {
      id: 'a',
      username: 'admin',
      role: 'admin',
      usedBytes: 0,
      quotaBytes: null,
      quotaSetting: 'unlimited',
    },
    {
      id: 'b',
      username: 'lea',
      role: 'user',
      usedBytes: 2 * GB,
      quotaBytes: 5 * GB,
      quotaSetting: 'default',
    },
  ],
  jobs: {
    queueHealthy: true,
    queued: 1,
    running: 2,
    done24h: 30,
    failed24h: 1,
    active: [
      {
        id: 'j1',
        user: 'lea',
        inputExt: 'mov',
        outputExt: 'mp4',
        status: 'running',
        progress: 40,
        stage: 'converting',
        createdAt: new Date().toISOString(),
      },
    ],
    recentErrors: [
      {
        id: 'j2',
        user: 'lea',
        inputExt: 'pdf',
        outputExt: 'docx',
        errorKey: 'errors.encrypted',
        createdAt: new Date().toISOString(),
      },
    ],
  },
  downloads: { queued: 0, running: 1 },
  engines: [
    { id: 'sharp', name: 'sharp', status: 'ready' },
    { id: 'whisper', name: 'Whisper', status: 'error' },
  ],
  models: [{ kind: 'whisper', id: 'small', bytes: 190_000_000, installed: false }],
};

describe('AdminView', () => {
  beforeEach(() => {
    api.get.mockReset().mockResolvedValue(overview);
    api.put.mockReset().mockResolvedValue(overview);
    role.value = 'admin';
  });

  it('shows load, storage, jobs, errors and engines', async () => {
    renderWithProviders(<AdminView />);
    const tiles = await screen.findAllByTestId('admin-tile');
    expect(tiles).toHaveLength(4);
    expect(within(tiles[0] as HTMLElement).getByText('2')).toBeInTheDocument();
    // 1 GB free of 100 GB: warned with words, not only colour.
    expect(screen.getByText('Speicherplatz knapp')).toBeInTheDocument();
    expect(screen.getByText(/lea · Wird umgewandelt/)).toBeInTheDocument();
    expect(screen.getByText(/Die Datei ist mit einem Passwort geschützt/)).toBeInTheDocument();
    expect(screen.getByText('nicht verfügbar')).toBeInTheDocument();
    expect(screen.getAllByTestId('admin-user')).toHaveLength(2);
  });

  it('is for admins only', () => {
    role.value = 'user';
    renderWithProviders(<AdminView />);
    expect(screen.getByText('Das darfst du nicht.')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
