/** Zoom and pan maths for the full-screen viewer (no React, easy to test). */

/** Where the picture sits: scaled by `zoom` around the box centre, then moved by x/y. */
export interface ZoomView {
  zoom: number;
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 10;
/** Double click / double tap jumps to this zoom. */
export const DOUBLE_TAP_ZOOM = 2.5;
export const FIT: ZoomView = { zoom: 1, x: 0, y: 0 };

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/**
 * Zoom to `zoom` so that the spot under `point` stays where it is.
 * `point` is measured from the box centre.
 */
export function zoomAround(
  view: ZoomView,
  zoom: number,
  point: { x: number; y: number },
): ZoomView {
  const next = clampZoom(zoom);
  const k = next / view.zoom;
  return { zoom: next, x: point.x - (point.x - view.x) * k, y: point.y - (point.y - view.y) * k };
}

/** How big the media is on screen at zoom 1 (fitted into the box, like object-contain). */
export function fitSize(natural: Size, box: Size): Size {
  if (natural.w <= 0 || natural.h <= 0) return box;
  const scale = Math.min(box.w / natural.w, box.h / natural.h);
  return { w: natural.w * scale, h: natural.h * scale };
}

/** Keeps the picture from being pushed out of sight: edges stop at the box edges. */
export function clampPan(view: ZoomView, content: Size, box: Size): ZoomView {
  const limitX = Math.max(0, (content.w * view.zoom - box.w) / 2);
  const limitY = Math.max(0, (content.h * view.zoom - box.h) / 2);
  const clamp = (v: number, limit: number) => Math.min(limit, Math.max(-limit, v)) || 0;
  return { zoom: view.zoom, x: clamp(view.x, limitX), y: clamp(view.y, limitY) };
}

/** Mouse wheel / trackpad pinch (arrives as Ctrl + wheel) → zoom factor. */
export function wheelFactor(deltaY: number, ctrlKey: boolean): number {
  return Math.exp(-deltaY * (ctrlKey ? 0.01 : 0.002));
}

/** Time as 1:05 or 1:02:03. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${String(h)}:${pad(m)}:${pad(s)}` : `${String(m)}:${pad(s)}`;
}

/** Leaves the browser's full screen again (when the viewer closes). */
export function exitBrowserFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}
