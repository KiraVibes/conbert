import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  ImageOffIcon,
  Loader2Icon,
  Maximize2Icon,
  MaximizeIcon,
  Minimize2Icon,
  PauseIcon,
  PlayIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { WholePostOverlay, type WholePostState } from './WholePostOverlay';
import type { SwipeMode } from '@conbert/schemas';
import {
  SIDE_THRESHOLD,
  STAMP_CLASS,
  TAP_PX,
  UP_THRESHOLD,
  actionFor,
  decideSwipe,
  keyToCommand,
  type SwipeDirection,
} from './use-swipe';
import {
  DOUBLE_TAP_ZOOM,
  FIT,
  clampPan,
  fitSize,
  formatTime,
  wheelFactor,
  zoomAround,
  type Size,
  type ZoomView,
} from './zoom';

const DOUBLE_TAP_MS = 300;
/** Drag down this far (at zoom 1) to close. */
const CLOSE_PX = 120;
const FLY_MS = 220;

/** Deciding right in the full-screen view (Swipe): drag, arrow keys or the buttons. */
export interface ViewerSwipe {
  mode: SwipeMode;
  onSwipe: (direction: SwipeDirection) => void;
  onUndo: () => void;
  /** Shift+←: the next left swipe deletes the whole Pixiv work. */
  onWholePost: () => void;
  /** X is held / the whole Pixiv work goes. */
  wholePost: WholePostState;
  /** The Pixiv work of the picture (null for other files). */
  postId: string | null;
  /** The buttons below the picture; `fly` lets the picture leave in that direction. */
  controls: (fly: (direction: SwipeDirection) => void) => React.ReactNode;
  /** Shown while there is no picture (loading or all sorted). */
  placeholder: React.ReactNode;
  /** No animations (reduced motion). */
  still: boolean;
}

/** The browser's own full screen (hides its bars) – not on every device. */
function useBrowserFullscreen() {
  const [on, setOn] = useState(() => document.fullscreenElement !== null);
  useEffect(() => {
    const update = () => setOn(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  };
  return { supported: document.fullscreenEnabled, on, toggle };
}

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** What the viewer shows. */
export interface ViewerMedia {
  id: string;
  name: string;
  kind: 'image' | 'gif' | 'video';
  url: string;
}

/** Videos are loaded completely first, so jumping around in them always works. */
function useVideoBlob(item: ViewerMedia | null) {
  const [state, setState] = useState<{ id: string; url?: string; failed?: boolean } | null>(null);
  useEffect(() => {
    if (item?.kind !== 'video') return;
    const controller = new AbortController();
    let url: string | undefined;
    fetch(item.url, { credentials: 'same-origin', signal: controller.signal })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setState({ id: item.id, url });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ id: item.id, failed: true });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [item]);
  return state?.id === item?.id ? state : null;
}

/**
 * The picture or video on the whole screen: pinch with two fingers, the mouse
 * wheel or a double tap zooms, dragging moves it. Swipe down or Esc closes.
 * With `swipe`, dragging sideways or up (at normal size) decides like on the card.
 * Render it with `key={item.id}` so every file starts fitted to the screen.
 */
export function FullscreenViewer({
  item,
  onClose,
  open = item !== null,
  swipe,
}: {
  item: ViewerMedia | null;
  onClose: () => void;
  open?: boolean;
  swipe?: ViewerSwipe;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [view, setViewState] = useState<ZoomView>(FIT);
  const viewRef = useRef<ZoomView>(FIT);
  const [natural, setNatural] = useState<Size>({ w: 0, h: 0 });
  const [box, setBox] = useState<Size>({ w: 1, h: 1 });
  const [dismiss, setDismiss] = useState(0);
  /** Sideways / upwards drag at normal size (only with `swipe`). */
  const [drag, setDrag] = useState<Point>({ x: 0, y: 0 });
  const [leaving, setLeaving] = useState<SwipeDirection | null>(null);
  const browserFullscreen = useBrowserFullscreen();
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const blob = useVideoBlob(item);
  const isVideo = item?.kind === 'video';

  const content = fitSize(natural, box);
  const setView = useCallback(
    (next: ZoomView) => {
      const clamped = next.zoom <= 1 ? FIT : clampPan(next, content, box);
      viewRef.current = clamped;
      setViewState(clamped);
    },
    [content, box],
  );

  // Stage size (rotating the phone, resizing the window).
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!stageEl) return;
    const measure = () => setBox({ w: stageEl.clientWidth || 1, h: stageEl.clientHeight || 1 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stageEl);
    return () => observer.disconnect();
  }, [stageEl]);

  /** Pointer position measured from the stage centre. */
  const relative = (clientX: number, clientY: number): Point => {
    const rect = stageEl?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };

  const zoomBy = (factor: number, at: Point = { x: 0, y: 0 }) =>
    setView(zoomAround(viewRef.current, viewRef.current.zoom * factor, at));

  const fly = useCallback(
    (direction: SwipeDirection) => {
      if (!swipe || !item || leaving) return;
      setDrag({ x: 0, y: 0 });
      if (swipe.still) {
        swipe.onSwipe(direction);
        return;
      }
      setLeaving(direction);
    },
    [swipe, item, leaving],
  );
  // The decision counts once the picture has flown out.
  const onSwipe = swipe?.onSwipe;
  useEffect(() => {
    if (!leaving || !onSwipe) return;
    const timer = window.setTimeout(() => onSwipe(leaving), FLY_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, onSwipe]);

  const togglePlay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  // Mouse wheel and trackpad pinch – a native listener, so the page itself never zooms.
  useEffect(() => {
    if (!stageEl) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = stageEl.getBoundingClientRect();
      const at = {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2,
      };
      setView(
        zoomAround(viewRef.current, viewRef.current.zoom * wheelFactor(e.deltaY, e.ctrlKey), at),
      );
    };
    stageEl.addEventListener('wheel', onWheel, { passive: false });
    return () => stageEl.removeEventListener('wheel', onWheel);
  }, [stageEl, setView]);

  // Fingers / mouse on the stage.
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{
    view: ZoomView;
    start: Point;
    pinch?: { mid: Point; dist: number };
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<{ at: number; p: Point } | null>(null);
  const singleTap = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(singleTap.current), []);

  const restart = (moved: boolean) => {
    const list = [...pointers.current.values()];
    if (list.length === 0) {
      gesture.current = null;
      return;
    }
    const [a, b] = list as [Point, Point | undefined];
    gesture.current = {
      view: viewRef.current,
      start: a,
      ...(b && { pinch: { mid: middle(a, b), dist: distance(a, b) || 1 } }),
      moved,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, relative(e.clientX, e.clientY));
    restart(pointers.current.size > 1);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, relative(e.clientX, e.clientY));
    const g = gesture.current;
    if (!g) return;
    const list = [...pointers.current.values()];
    if (g.pinch && list.length >= 2) {
      const [a, b] = list as [Point, Point];
      const mid = middle(a, b);
      const moved: ZoomView = {
        zoom: g.view.zoom,
        x: g.view.x + mid.x - g.pinch.mid.x,
        y: g.view.y + mid.y - g.pinch.mid.y,
      };
      setView(zoomAround(moved, (g.view.zoom * distance(a, b)) / g.pinch.dist, mid));
      return;
    }
    const p = list[0];
    if (!p) return;
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > TAP_PX) g.moved = true;
    if (!g.moved) return;
    if (g.view.zoom > 1) setView({ zoom: g.view.zoom, x: g.view.x + dx, y: g.view.y + dy });
    else if (swipe && item && !leaving) {
      // Down closes; sideways and up decide like on the card.
      const down = dy > 0 && dy > Math.abs(dx);
      setDismiss(down ? dy : 0);
      setDrag(down ? { x: 0, y: 0 } : { x: dx, y: Math.min(0, dy) });
    } else if (Math.abs(dy) > Math.abs(dx)) setDismiss(Math.max(0, dy));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size > 0) {
      // One finger stays after a pinch: keep moving from here.
      restart(true);
      return;
    }
    gesture.current = null;
    if (dismiss > CLOSE_PX) {
      onClose();
      return;
    }
    setDismiss(0);
    if (swipe && (drag.x !== 0 || drag.y !== 0)) {
      const direction =
        e.type === 'pointercancel' ? null : decideSwipe(drag.x, drag.y, box.w, box.h);
      if (direction) fly(direction);
      else setDrag({ x: 0, y: 0 });
      return;
    }
    if (!g || g.moved || e.type === 'pointercancel') return;
    const p = relative(e.clientX, e.clientY);
    const now = performance.now();
    const last = lastTap.current;
    if (last && now - last.at < DOUBLE_TAP_MS && distance(last.p, p) < 30) {
      lastTap.current = null;
      window.clearTimeout(singleTap.current);
      setView(viewRef.current.zoom > 1 ? FIT : zoomAround(viewRef.current, DOUBLE_TAP_ZOOM, p));
      return;
    }
    lastTap.current = { at: now, p };
    if (isVideo) singleTap.current = window.setTimeout(togglePlay, DOUBLE_TAP_MS);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('[role="slider"]')) return;
    const command = swipe ? keyToCommand(e) : null;
    if (command === 'undo') swipe?.onUndo();
    else if (command === 'fullscreen') onClose();
    else if (command) {
      if (command === 'left' && e.shiftKey && swipe?.postId) swipe.onWholePost();
      fly(command);
    } else if (e.key === '+' || e.key === '=') zoomBy(1.5);
    else if (e.key === '-') zoomBy(1 / 1.5);
    else if (e.key === '0') setView(FIT);
    else if (e.key === ' ' && isVideo && !(e.target as HTMLElement).closest('button')) togglePlay();
    else return;
    e.preventDefault();
  };

  const zoomed = view.zoom > 1;
  const fitScale = natural.w > 0 ? content.w / natural.w : 1;
  // Leaving pictures fly out of the screen, like the cards.
  const swipeX = leaving === 'left' ? -1.5 * box.w : leaving === 'right' ? 1.5 * box.w : drag.x;
  const swipeY = leaving === 'up' ? -1.5 * box.h : drag.y;
  const dragging = drag.x !== 0 || drag.y !== 0;
  const mediaStyle: React.CSSProperties = {
    transform: `translate(${String(view.x + swipeX)}px, ${String(view.y + dismiss + swipeY)}px) rotate(${String(swipeX / 40)}deg) scale(${String(view.zoom)})`,
    imageRendering: view.zoom * fitScale > 2 ? 'pixelated' : 'auto',
    transition: leaving ? `transform ${String(FLY_MS)}ms ease-in` : undefined,
  };
  // Which stamp shows (fades in towards the threshold).
  const hint: { direction: SwipeDirection; strength: number } | null = leaving
    ? { direction: leaving, strength: 1 }
    : !dragging
      ? null
      : -drag.y > Math.abs(drag.x)
        ? { direction: 'up', strength: Math.min(1, -drag.y / (box.h * UP_THRESHOLD)) }
        : {
            direction: drag.x > 0 ? 'right' : 'left',
            strength: Math.min(1, Math.abs(drag.x) / (box.w * SIDE_THRESHOLD)),
          };
  const stamp = swipe && hint && !swipe.wholePost ? actionFor(swipe.mode, hint.direction) : null;
  const mediaClass =
    'absolute inset-0 h-full w-full object-contain select-none pointer-events-none';

  let media: React.ReactNode = null;
  if (!item && swipe) {
    media = (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white/80">
        {swipe.placeholder}
      </div>
    );
  } else if (item && failed) {
    media = (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-white/70">
        <ImageOffIcon className="size-8" aria-hidden="true" />
        {t('swipe.cannotShow')}
      </div>
    );
  } else if (item && isVideo) {
    media = blob?.failed ? (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/70">
        {t('swipe.viewer.loadFailed')}
      </div>
    ) : blob?.url ? (
      <video
        ref={video}
        src={blob.url}
        className={mediaClass}
        style={mediaStyle}
        autoPlay
        loop
        playsInline
        muted={muted}
        aria-label={item.name}
        onLoadedMetadata={(e) =>
          setNatural({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })
        }
        onDurationChange={(e) => {
          const duration = e.currentTarget.duration;
          setTime((s) => ({ ...s, duration: Number.isFinite(duration) ? duration : 0 }));
        }}
        onTimeUpdate={(e) => {
          const current = e.currentTarget.currentTime;
          setTime((s) => ({ ...s, current }));
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
    ) : (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-white/70">
        <Loader2Icon className="size-6 animate-spin" aria-hidden="true" />
        {t('swipe.viewer.loading')}
      </div>
    );
  } else if (item) {
    media = (
      <img
        src={item.url}
        alt={item.name}
        draggable={false}
        className={mediaClass}
        style={mediaStyle}
        onLoad={(e) =>
          setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
        }
        onError={() => setFailed(true)}
      />
    );
  }

  const barButton = 'text-white hover:bg-white/15 hover:text-white';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black"
          style={{ opacity: Math.max(0.4, 1 - dismiss / 400) }}
        />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
          onKeyDown={onKeyDown}
          data-testid="swipe-viewer"
        >
          <div className="flex items-center gap-2 bg-black/60 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-medium">
              {item?.name}
            </DialogPrimitive.Title>
            {browserFullscreen.supported && (
              <Button
                size="icon"
                variant="ghost"
                className={barButton}
                onClick={browserFullscreen.toggle}
                aria-label={t(
                  browserFullscreen.on ? 'swipe.viewer.screenOff' : 'swipe.viewer.screenOn',
                )}
                title={t(browserFullscreen.on ? 'swipe.viewer.screenOff' : 'swipe.viewer.screenOn')}
              >
                {browserFullscreen.on ? (
                  <Minimize2Icon aria-hidden="true" />
                ) : (
                  <Maximize2Icon aria-hidden="true" />
                )}
              </Button>
            )}
            <DialogPrimitive.Close asChild>
              <Button
                size="icon"
                variant="ghost"
                className={barButton}
                aria-label={t('swipe.viewer.close')}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div
            ref={setStageEl}
            className={cn(
              'relative min-h-0 flex-1 touch-none overflow-hidden',
              zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {media}
            {swipe && item && <WholePostOverlay state={swipe.wholePost} postId={swipe.postId} />}
            {stamp && hint && (
              <span
                className={cn(
                  'pointer-events-none absolute rounded-lg border-4 bg-black/60 px-3 py-1 text-2xl font-black tracking-wider uppercase',
                  STAMP_CLASS[stamp],
                )}
                style={{ opacity: hint.strength }}
              >
                {t(`swipe.stamps.${stamp}`)}
              </span>
            )}
          </div>

          <div className="space-y-2 bg-black/60 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {swipe?.controls(fly)}
            {isVideo && blob?.url && !failed && (
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className={barButton}
                  onClick={togglePlay}
                  aria-label={t(playing ? 'swipe.viewer.pause' : 'swipe.viewer.play')}
                >
                  {playing ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
                </Button>
                <span className="w-24 shrink-0 text-xs tabular-nums text-white/80">
                  {formatTime(time.current)} / {formatTime(time.duration)}
                </span>
                <Slider
                  className="flex-1"
                  min={0}
                  max={time.duration || 1}
                  step={0.1}
                  value={[Math.min(time.current, time.duration || 1)]}
                  onValueChange={([v]) => {
                    if (video.current && v !== undefined) video.current.currentTime = v;
                  }}
                  aria-label={t('swipe.viewer.seek')}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className={barButton}
                  onClick={() => setMuted((m) => !m)}
                  aria-label={t(muted ? 'swipe.viewer.unmute' : 'swipe.viewer.mute')}
                >
                  {muted ? <VolumeXIcon aria-hidden="true" /> : <Volume2Icon aria-hidden="true" />}
                </Button>
              </div>
            )}
            <div className="flex items-center justify-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className={barButton}
                onClick={() => zoomBy(1 / 1.5)}
                disabled={!zoomed}
                aria-label={t('preview.zoomOut')}
              >
                <ZoomOutIcon aria-hidden="true" />
              </Button>
              <span className="w-14 text-center text-sm tabular-nums" aria-live="polite">
                {Math.round(view.zoom * 100)} %
              </span>
              <Button
                size="icon"
                variant="ghost"
                className={barButton}
                onClick={() => zoomBy(1.5)}
                aria-label={t('preview.zoomIn')}
              >
                <ZoomInIcon aria-hidden="true" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className={barButton}
                onClick={() => setView(FIT)}
                disabled={!zoomed}
                aria-label={t('preview.fit')}
              >
                <MaximizeIcon aria-hidden="true" />
              </Button>
            </div>
            <DialogPrimitive.Description className="text-center text-xs text-white/60">
              {swipe
                ? `${t(swipe.mode === 'favorites' ? 'swipe.legendFavorites' : 'swipe.legend')} · ${t(isVideo ? 'swipe.viewer.hintSwipeVideo' : 'swipe.viewer.hintSwipe')}`
                : t(isVideo ? 'swipe.viewer.hintVideo' : 'swipe.viewer.hint')}
            </DialogPrimitive.Description>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
