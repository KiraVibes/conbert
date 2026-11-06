import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimilarItem, SimilarResponse } from '@conbert/schemas';
import type * as Api from '@/lib/api';
import { renderWithProviders } from '@/test/render';
import { SimilarView } from './SimilarView';

const api = vi.hoisted(() => ({
  response: null as unknown,
  get: vi.fn(),
  post: vi.fn(),
  swipe: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  apiGet: (...args: unknown[]) => api.get(...args),
  apiPost: (...args: unknown[]) => api.post(...args),
}));

vi.mock('./swipe-api', () => ({
  useMediaStatus: () => ({
    isPending: false,
    isError: false,
    data: { problem: null, items: 5, target: { id: 't', name: 'NAS' } },
  }),
  useSwipeSources: () => ({ data: { sources: [] } }),
  cardUrl: (item: SimilarItem) => `/file/${item.id}`,
  sendSwipe: (...args: unknown[]) => api.swipe(...args),
}));

const item = (id: string, patch: Partial<SimilarItem> = {}): SimilarItem => ({
  id,
  targetId: 't',
  path: `Insta/${id}.jpg`,
  name: `${id}.jpg`,
  size: 1000,
  kind: 'image',
  status: 'present',
  width: 800,
  height: 600,
  distance: 2,
  ...patch,
});

const response = (groups: SimilarItem[][]): SimilarResponse => ({
  scan: { running: false, done: 0, total: 0, failed: 0, error: null },
  unhashed: 2,
  hashed: 5,
  groups,
});

describe('SimilarView', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset().mockResolvedValue({});
    api.swipe.mockReset().mockResolvedValue({ pending: 1, done: [] });
  });

  it('suggests keeping the best picture and favourites, deletes the rest', async () => {
    api.get.mockResolvedValue(
      response([
        [
          item('best', { width: 4000, height: 3000, distance: 0 }),
          item('copy'),
          item('fav', { status: 'favorite' }),
        ],
      ]),
    );
    renderWithProviders(<SimilarView />);
    const group = await screen.findByTestId('similar-group');
    expect(within(group).getByText('Beste Fassung – wird behalten')).toBeInTheDocument();
    expect(within(group).getByText('Favorit – bleibt')).toBeInTheDocument();
    expect(screen.getByText('5 von 7 Bildern sind verglichen.')).toBeInTheDocument();

    await userEvent.click(within(group).getByRole('button', { name: '1 Bild löschen' }));
    await waitFor(() => expect(api.swipe).toHaveBeenCalledWith('copy', 'delete'));
    expect(api.swipe).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/swipe/flush', {});
    await waitFor(() => expect(screen.queryByTestId('similar-group')).not.toBeInTheDocument());
  });

  it('never deletes a whole group and starts comparing new pictures', async () => {
    api.get.mockResolvedValue(response([[item('a', { distance: 0 }), item('b')]]));
    renderWithProviders(<SimilarView />);
    const group = await screen.findByTestId('similar-group');
    const boxes = within(group).getAllByRole('checkbox');
    await userEvent.click(boxes[0] as HTMLElement);
    expect(
      within(group).getByText('Mindestens ein Bild der Gruppe muss bleiben.'),
    ).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /löschen/ })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '2 neue Bilder vergleichen' }));
    expect(api.post).toHaveBeenCalledWith(
      '/api/media/similar/scan',
      { folders: [] },
      expect.anything(),
    );
  });
});
