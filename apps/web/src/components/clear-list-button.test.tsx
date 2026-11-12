import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ClearListButton } from './ClearListButton';

describe('clear list button', () => {
  it('asks first, then empties the list', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    renderWithProviders(
      <ClearListButton count={3} textKey="clearList.downloads" onConfirm={onConfirm} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Liste leeren' }));
    expect(await screen.findByText('3 fertige Einträge entfernen?')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });

  it('is not there when nothing is finished', () => {
    renderWithProviders(
      <ClearListButton
        count={0}
        textKey="clearList.downloads"
        onConfirm={() => Promise.resolve()}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
