import { useCallback, useRef, useState } from 'react';
import type { SwipeAction, SwipeMode } from '@conbert/schemas';

export type SwipeDirection = 'left' | 'right' | 'up';

/** How far a card has to travel before it counts (share of the card's size). */
export const SIDE_THRESHOLD = 0.3;
export const UP_THRESHOLD = 0.25;

/** Where a drag ends up – or null when the card should spring back. */
export function decideSwipe(
  dx: number,
  dy: number,
  width: number,
  height: number,
): SwipeDirection | null {
  if (-dy > height * UP_THRESHOLD && Math.abs(dy) > Math.abs(dx)) return 'up';
  if (dx > width * SIDE_THRESHOLD) return 'right';
  if (dx < -width * SIDE_THRESHOLD) return 'left';
  return null;
}

/** A press that barely moved is a tap (opens the full-screen view). */
export const TAP_PX = 8;
export const isTap = (dx: number, dy: number) => Math.hypot(dx, dy) < TAP_PX;

/** What a direction means in each mode. */
export function actionFor(mode: SwipeMode, direction: SwipeDirection): SwipeAction {
  if (mode === 'favorites') {
    return direction === 'left' ? 'unfavorite' : direction === 'up' ? 'premium' : 'keep';
  }
  return direction === 'left' ? 'delete' : direction === 'up' ? 'favorite' : 'keep';
}

/** The key that means a direction (← → ↑), "undo" (Backspace, Ctrl+Z) or full screen (F). */
export function keyToCommand(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): SwipeDirection | 'undo' | 'fullscreen' | null {
  if (event.key === 'ArrowLeft') return 'left';
  if (event.key === 'ArrowRight') return 'right';
  if (event.key === 'ArrowUp') return 'up';
  if (event.key === 'Backspace') return 'undo';
  if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey) return 'fullscreen';
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') return 'undo';
  return null;
}

interface DragState {
  x: number;
  y: number;
  /** The card's size when the drag began. */
  width: number;
  height: number;
  dragging: boolean;
  /** The card flies out in this direction. */
  leaving: SwipeDirection | null;
}

const REST: DragState = { x: 0, y: 0, width: 1, height: 1, dragging: false, leaving: null };
const FLY_MS = 220;

/**
 * Drag a card with mouse, finger or pen. Releasing beyond the threshold
 * lets it fly out and reports the direction; otherwise it springs back.
 * A tap (no real movement) calls `onTap`.
 */
export function useSwipeGesture(
  onSwipe: (direction: SwipeDirection) => void,
  still: boolean,
  onTap?: () => void,
) {
  const [state, setState] = useState<DragState>(REST);
  const start = useRef<{ x: number; y: number; id: number; width: number; height: number } | null>(
    null,
  );

  const fly = useCallback(
    (direction: SwipeDirection) => {
      setState({ ...REST, leaving: direction });
      window.setTimeout(
        () => {
          setState(REST);
          onSwipe(direction);
        },
        still ? 0 : FLY_MS,
      );
    },
    [onSwipe, still],
  );

  const bind = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || state.leaving) return;
      const box = e.currentTarget.getBoundingClientRect();
      const width = box.width || 1;
      const height = box.height || 1;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, width, height };
      e.currentTarget.setPointerCapture(e.pointerId);
      setState({ ...REST, width, height, dragging: true });
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      setState({
        x: e.clientX - s.x,
        y: e.clientY - s.y,
        width: s.width,
        height: s.height,
        dragging: true,
        leaving: null,
      });
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      start.current = null;
      if (isTap(e.clientX - s.x, e.clientY - s.y)) {
        setState(REST);
        onTap?.();
        return;
      }
      const direction = decideSwipe(e.clientX - s.x, e.clientY - s.y, s.width, s.height);
      if (direction) fly(direction);
      else setState(REST);
    },
    onPointerCancel: () => {
      start.current = null;
      setState(REST);
    },
  };

  // Which stamp shows while dragging (fades in towards the threshold).
  const hint: { direction: SwipeDirection; strength: number } | null = (() => {
    if (state.leaving) return { direction: state.leaving, strength: 1 };
    const { width, height } = state;
    if (!state.dragging) return null;
    if (-state.y > Math.abs(state.x)) {
      return { direction: 'up', strength: Math.min(1, -state.y / (height * UP_THRESHOLD)) };
    }
    if (state.x === 0) return null;
    return {
      direction: state.x > 0 ? 'right' : 'left',
      strength: Math.min(1, Math.abs(state.x) / (width * SIDE_THRESHOLD)),
    };
  })();

  return { state, bind, fly, hint };
}
