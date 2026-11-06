import { describe, expect, it } from 'vitest';
import { findMissingKeys } from '@conbert/i18n';
import { swipeActionSchema, type SwipeAction } from '@conbert/schemas';
import { actionFor, decideSwipe, isTap, keyToCommand } from './use-swipe';
import { countDone, doneList } from './tally';
import { MAX_ZOOM, clampPan, fitSize, formatTime, wheelFactor, zoomAround } from './zoom';

describe('swipe gestures', () => {
  it('counts a card as swiped only past the threshold', () => {
    // Card 400 × 600: sideways from 120 px, upwards from 150 px.
    expect(decideSwipe(100, 0, 400, 600)).toBeNull();
    expect(decideSwipe(130, 10, 400, 600)).toBe('right');
    expect(decideSwipe(-130, 40, 400, 600)).toBe('left');
    expect(decideSwipe(20, -160, 400, 600)).toBe('up');
    // Mostly sideways with a little up: sideways wins.
    expect(decideSwipe(200, -160, 400, 600)).toBe('right');
    // Downwards means nothing.
    expect(decideSwipe(0, 300, 400, 600)).toBeNull();
  });

  it('means something different in the favourites', () => {
    expect(actionFor('normal', 'left')).toBe('delete');
    expect(actionFor('normal', 'right')).toBe('keep');
    expect(actionFor('normal', 'up')).toBe('favorite');
    expect(actionFor('favorites', 'left')).toBe('unfavorite');
    expect(actionFor('favorites', 'right')).toBe('keep');
    expect(actionFor('favorites', 'up')).toBe('premium');
  });

  it('works with the keyboard', () => {
    expect(keyToCommand({ key: 'ArrowLeft' })).toBe('left');
    expect(keyToCommand({ key: 'ArrowUp' })).toBe('up');
    expect(keyToCommand({ key: 'ArrowRight' })).toBe('right');
    expect(keyToCommand({ key: 'Backspace' })).toBe('undo');
    expect(keyToCommand({ key: 'z', ctrlKey: true })).toBe('undo');
    expect(keyToCommand({ key: 'z' })).toBeNull();
    expect(keyToCommand({ key: 'f' })).toBe('fullscreen');
    expect(keyToCommand({ key: 'F' })).toBe('fullscreen');
    expect(keyToCommand({ key: 'f', ctrlKey: true })).toBeNull();
  });

  it('opens full screen only on a tap, not a drag', () => {
    expect(isTap(0, 0)).toBe(true);
    expect(isTap(3, -4)).toBe(true);
    expect(isTap(20, 0)).toBe(false);
  });
});

describe('full-screen zoom', () => {
  it('keeps the spot under the fingers or the mouse in place', () => {
    const start = { zoom: 1, x: 0, y: 0 };
    const at = { x: 100, y: -50 };
    const view = zoomAround(start, 2, at);
    expect(view.zoom).toBe(2);
    // The content point under `at` was (100, -50); after zooming it still is.
    expect(view.x + 100 * view.zoom).toBe(100);
    expect(view.y + -50 * view.zoom).toBe(-50);
    // Zooming back out returns to where it was.
    expect(zoomAround(view, 1, at)).toEqual(start);
  });

  it('stays between fitted and the maximum', () => {
    expect(zoomAround({ zoom: 1, x: 0, y: 0 }, 0.2, { x: 0, y: 0 }).zoom).toBe(1);
    expect(zoomAround({ zoom: 1, x: 0, y: 0 }, 99, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
  });

  it('fits like object-contain and never pushes the picture out of sight', () => {
    const box = { w: 400, h: 800 };
    const content = fitSize({ w: 2000, h: 1000 }, box);
    expect(content).toEqual({ w: 400, h: 200 });
    // At 2× the picture is 800 × 400: 200 px to each side, but no room up or down.
    expect(clampPan({ zoom: 2, x: 999, y: 999 }, content, box)).toEqual({ zoom: 2, x: 200, y: 0 });
    expect(clampPan({ zoom: 2, x: -50, y: 0 }, content, box)).toEqual({ zoom: 2, x: -50, y: 0 });
  });

  it('zooms in when the wheel turns up', () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, false)).toBeLessThan(1);
    // Trackpad pinch sends small steps with Ctrl.
    expect(wheelFactor(-10, true)).toBeGreaterThan(wheelFactor(-10, false));
  });

  it('shows video times readably', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65.4)).toBe('1:05');
    expect(formatTime(3723)).toBe('1:02:03');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });
});

describe('carried-out tally', () => {
  it('counts only what really happened', () => {
    const outcome = (action: SwipeAction, ok = true) => ({
      itemId: 'x',
      name: 'x.jpg',
      action,
      ok,
      error: ok ? null : 'STORAGE_FAILED',
    });
    const tally = countDone({ delete: 1 }, [
      outcome('delete'),
      outcome('favorite'),
      outcome('keep', false),
    ]);
    expect(tally).toEqual({ delete: 2, favorite: 1 });
    const t = (key: string, o: { count: number }) => `${key}:${String(o.count)}`;
    expect(doneList(t, tally)).toBe('swipe.done.delete:2, swipe.done.favorite:1');
    expect(doneList(t, {})).toBe('');
  });
});

describe('swipe texts', () => {
  it('has a text for every action, problem and reason', () => {
    const keys = [
      ...swipeActionSchema.options.flatMap((a) => [
        `swipe.buttons.${a}`,
        `swipe.stamps.${a}`,
        `swipe.done.${a}_one`,
        `swipe.done.${a}_other`,
      ]),
      ...['summary', 'summaryNothing', 'carried', 'newRound'].map((k) => `swipe.${k}`),
      ...['no-default', 'not-source', 'not-target'].flatMap((p) =>
        ['what', 'cause', 'action'].map((part) => `swipe.problems.${p}.${part}`),
      ),
      ...['download', 'feed', 'booru'].map((r) => `swipe.tidy.reasons.${r}`),
      ...[
        'open',
        'close',
        'hint',
        'hintVideo',
        'loading',
        'loadFailed',
        'play',
        'pause',
        'mute',
        'unmute',
        'seek',
      ].map((k) => `swipe.viewer.${k}`),
      ...['mediaNoDefault', 'mediaSyncRunning', 'mediaAlreadySwiped'].flatMap((e) =>
        ['what', 'cause', 'action'].map((part) => `errors.${e}.${part}`),
      ),
    ];
    expect(findMissingKeys(keys)).toEqual([]);
  });
});
