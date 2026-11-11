import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { HOLD_MS, HoldButton } from './HoldButton';

afterEach(() => vi.useRealTimers());

function setup(withHold = true) {
  const onPress = vi.fn();
  const onHold = vi.fn();
  const onHoldChange = vi.fn();
  renderWithProviders(
    <HoldButton onPress={onPress} onHold={withHold ? onHold : null} onHoldChange={onHoldChange}>
      x
    </HoldButton>,
  );
  return { onPress, onHold, onHoldChange, button: screen.getByRole('button', { name: 'x' }) };
}

describe('the delete button that can be held', () => {
  it('a short press is a normal press', () => {
    const { onPress, onHold, button } = setup();
    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
    expect(onHold).not.toHaveBeenCalled();
  });

  it('holding calls the other action, and the click after it is ignored', () => {
    vi.useFakeTimers();
    const { onPress, onHold, onHoldChange, button } = setup();
    fireEvent.pointerDown(button, { button: 0 });
    // The ring fills while held.
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('hold-ring')).toHaveAttribute('data-holding', 'true');
    act(() => vi.advanceTimersByTime(HOLD_MS + 10));
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    expect(onHold).toHaveBeenCalledOnce();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('letting go early cancels the hold', () => {
    vi.useFakeTimers();
    const { onHold, onHoldChange, button } = setup();
    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS / 2));
    fireEvent.pointerUp(button);
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).not.toHaveBeenCalled();
  });

  it('without a hold action it stays a normal button', () => {
    vi.useFakeTimers();
    const { onPress, button } = setup(false);
    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(HOLD_MS + 10));
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
  });
});
