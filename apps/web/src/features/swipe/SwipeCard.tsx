import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExpandIcon, ImageOffIcon } from 'lucide-react';
import type { SwipeItem, SwipeMode } from '@conbert/schemas';
import { cn } from '@/lib/utils';
import { cardUrl } from './swipe-api';
import { STAMP_CLASS, actionFor, type SwipeDirection } from './use-swipe';

/** The picture, GIF or video itself. */
function Media({ item, play }: { item: SwipeItem; play: boolean }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  // The card behind already exists when it moves to the top, so `autoPlay`
  // (only read when the element is created) would never start it: play here.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (play) void v.play().catch(() => undefined);
    else v.pause();
  }, [play]);
  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <ImageOffIcon className="size-8" aria-hidden="true" />
        {t('swipe.cannotShow')}
      </div>
    );
  }
  if (item.kind === 'video') {
    return (
      <video
        ref={video}
        src={cardUrl(item)}
        className="pointer-events-none h-full w-full object-contain"
        muted
        loop
        playsInline
        preload={play ? 'auto' : 'metadata'}
        onError={() => setFailed(true)}
        aria-label={item.name}
      />
    );
  }
  return (
    <img
      src={cardUrl(item)}
      alt={item.name}
      draggable={false}
      className="pointer-events-none h-full w-full object-contain select-none"
      onError={() => setFailed(true)}
    />
  );
}

export function SwipeCard({
  item,
  mode,
  active,
  shimmer,
  drag,
  hint,
  bind,
  onOpen,
  paused = false,
}: {
  item: SwipeItem;
  mode: SwipeMode;
  /** The top card (the one behind waits, a little smaller). */
  active: boolean;
  /** Premium frame shimmers (off with reduced motion or without magic effects). */
  shimmer: boolean;
  drag?: { x: number; y: number; dragging: boolean; leaving: SwipeDirection | null };
  hint?: { direction: SwipeDirection; strength: number } | null;
  bind?: Record<string, (e: React.PointerEvent<HTMLElement>) => void>;
  /** Show it on the whole screen (also a tap on the card). */
  onOpen?: () => void;
  /** Stops the video (e.g. while it is shown full screen). */
  paused?: boolean;
}) {
  const { t } = useTranslation();
  const leaving = drag?.leaving;
  const x = leaving === 'left' ? -1.5 * 600 : leaving === 'right' ? 1.5 * 600 : (drag?.x ?? 0);
  const y = leaving === 'up' ? -1.5 * 800 : (drag?.y ?? 0);
  const transform = active
    ? `translate(${String(x)}px, ${String(y)}px) rotate(${String(x / 20)}deg)`
    : 'scale(0.95) translateY(12px)';
  const premium = item.status === 'premium';
  const action = hint ? actionFor(mode, hint.direction) : null;
  const folder = item.path.slice(0, item.path.length - item.name.length - 1);
  return (
    <div
      className={cn(
        'absolute inset-0 rounded-2xl',
        active ? 'z-10 cursor-grab touch-none active:cursor-grabbing' : 'z-0 opacity-70',
        !drag?.dragging && 'transition-transform duration-200 ease-out',
        premium && 'premium-frame p-[3px]',
        premium && !shimmer && 'premium-frame-still',
      )}
      style={{ transform }}
      {...(active && bind)}
      aria-hidden={!active}
    >
      <div className="relative flex h-full flex-col overflow-hidden rounded-[0.9rem] border bg-neutral-950 shadow-xl">
        <div className="relative min-h-0 flex-1">
          <Media item={item} play={active && !paused} />
          {active && onOpen && (
            <button
              type="button"
              className="absolute top-2 right-2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onOpen}
              aria-label={t('swipe.viewer.open')}
              title={`${t('swipe.viewer.open')} (F)`}
            >
              <ExpandIcon className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 bg-background/90 px-3 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{item.name}</p>
            <p className="truncate text-xs text-muted-foreground">{folder || '/'}</p>
          </div>
          {premium && (
            <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-300">
              {t('swipe.premium')}
            </span>
          )}
        </div>
        {action && hint && (
          <span
            className={cn(
              'pointer-events-none absolute rounded-lg border-4 bg-background/70 px-3 py-1 text-2xl font-black tracking-wider uppercase',
              STAMP_CLASS[action],
            )}
            style={{ opacity: hint.strength }}
          >
            {t(`swipe.stamps.${action}`)}
          </span>
        )}
      </div>
    </div>
  );
}
