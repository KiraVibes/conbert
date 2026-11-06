import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  ImageOffIcon,
  Loader2Icon,
  MaximizeIcon,
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
import { TAP_PX } from './use-swipe';
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
 * Render it with `key={item.id}` so every file starts fitted to the screen.
 */
export function FullscreenViewer({
  item,
  onClose,
}: {
  item: ViewerMedia | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement>(null);
  const [view, setViewState] = useState<ZoomView>(FIT);
  const viewRef = useRef<ZoomView>(FIT);
  const [natural, setNatural] = useState<Size>({ w: 0, h: 0 });
  const [box, setBox] = useState<Size>({ w: 1, h: 1 });
  const [dismiss, setDismiss] = useState(0);
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
    else if (Math.abs(dy) > Math.abs(dx)) setDismiss(Math.max(0, dy));
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
    if (e.key === '+' || e.key === '=') zoomBy(1.5);
    else if (e.key === '-') zoomBy(1 / 1.5);
    else if (e.key === '0') setView(FIT);
    else if (e.key === ' ' && isVideo && !(e.target as HTMLElement).closest('button')) togglePlay();
    else return;
    e.preventDefault();
  };

  const zoomed = view.zoom > 1;
  const fitScale = natural.w > 0 ? content.w / natural.w : 1;
  const mediaStyle: React.CSSProperties = {
    transform: `translate(${String(view.x)}px, ${String(view.y + dismiss)}px) scale(${String(view.zoom)})`,
    imageRendering: view.zoom * fitScale > 2 ? 'pixelated' : 'auto',
  };
  const mediaClass =
    'absolute inset-0 h-full w-full object-contain select-none pointer-events-none';

  let media: React.ReactNode = null;
  if (item && failed) {
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
    <DialogPrimitive.Root open={item !== null} onOpenChange={(open) => !open && onClose()}>
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
          </div>

          <div className="space-y-2 bg-black/60 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
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
              {t(isVideo ? 'swipe.viewer.hintVideo' : 'swipe.viewer.hint')}
            </DialogPrimitive.Description>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
