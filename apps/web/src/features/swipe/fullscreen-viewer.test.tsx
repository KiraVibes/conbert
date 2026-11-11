import { act, fireEvent, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { FullscreenViewer, type ViewerSwipe } from './FullscreenViewer';

beforeAll(() => {
  // jsdom has no pointer capture.
  Element.prototype.setPointerCapture ??= () => {};
});

const item = { id: 'a', name: 'cat.jpg', kind: 'image' as const, url: '/file/a' };

function setup(patch: Partial<ViewerSwipe> = {}) {
  const swipe: ViewerSwipe = {
    mode: 'normal',
    onSwipe: vi.fn(),
    onUndo: vi.fn(),
    onWholePost: vi.fn(),
    wholePost: null,
    postId: '42',
    still: true,
    controls: (fly) => (
      <button type="button" onClick={() => fly('up')}>
        favourite
      </button>
    ),
    placeholder: <p>all sorted</p>,
    ...patch,
  };
  renderWithProviders(<FullscreenViewer item={item} onClose={vi.fn()} swipe={swipe} />);
  return swipe;
}

/** Drags on the stage (the area that holds the picture). */
function drag(dx: number, dy: number) {
  const stage = screen.getByRole('img', { name: 'cat.jpg' }).parentElement;
  if (!stage) throw new Error('no stage');
  const at = (x: number, y: number) => ({ pointerId: 1, button: 0, clientX: x, clientY: y });
  fireEvent.pointerDown(stage, at(100, 100));
  fireEvent.pointerMove(stage, at(100 + dx / 2, 100 + dy / 2));
  fireEvent.pointerMove(stage, at(100 + dx, 100 + dy));
  fireEvent.pointerUp(stage, at(100 + dx, 100 + dy));
}

describe('swiping in the full-screen view', () => {
  it('decides with the arrow keys and takes back with Backspace', () => {
    const swipe = setup();
    const dialog = screen.getByTestId('swipe-viewer');
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(swipe.onSwipe).toHaveBeenLastCalledWith('left');
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(swipe.onSwipe).toHaveBeenLastCalledWith('right');
    fireEvent.keyDown(dialog, { key: 'Backspace' });
    expect(swipe.onUndo).toHaveBeenCalledOnce();
    // Shift+←: the whole Pixiv work.
    expect(swipe.onWholePost).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: 'ArrowLeft', shiftKey: true });
    expect(swipe.onWholePost).toHaveBeenCalledOnce();
    expect(swipe.onSwipe).toHaveBeenLastCalledWith('left');
  });

  it('decides by dragging sideways or up, like on the card', () => {
    const swipe = setup();
    drag(400, 0);
    expect(swipe.onSwipe).toHaveBeenLastCalledWith('right');
    drag(0, -400);
    expect(swipe.onSwipe).toHaveBeenLastCalledWith('up');
  });

  it('lets the picture fly out before it decides (with animations)', () => {
    vi.useFakeTimers();
    try {
      const swipe = setup({ still: false });
      fireEvent.click(screen.getByRole('button', { name: 'favourite' }));
      expect(swipe.onSwipe).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(300));
      expect(swipe.onSwipe).toHaveBeenCalledWith('up');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows over the picture that the whole post goes while X is held', () => {
    setup({ wholePost: 'holding' });
    const overlay = screen.getByTestId('whole-post-overlay');
    expect(overlay).toHaveAttribute('data-state', 'holding');
    expect(overlay).toHaveTextContent('42');
  });

  it('shows what comes when there is no picture', () => {
    renderWithProviders(
      <FullscreenViewer
        item={null}
        open
        onClose={vi.fn()}
        swipe={{
          mode: 'normal',
          onSwipe: vi.fn(),
          onUndo: vi.fn(),
          onWholePost: vi.fn(),
          wholePost: null,
          postId: null,
          still: true,
          controls: () => null,
          placeholder: <p>all sorted</p>,
        }}
      />,
    );
    expect(screen.getByText('all sorted')).toBeInTheDocument();
  });
});
