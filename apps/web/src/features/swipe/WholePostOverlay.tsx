import { useTranslation } from 'react-i18next';
import { HOLD_MS } from './HoldButton';

/** Holding X: fills in while held; "armed" once it fired (the card flies out). */
export type WholePostState = 'holding' | 'armed' | null;

/**
 * Over the picture while X is held: a red veil and the stamp "All gone" fade
 * in over the hold time, with which work goes – so it's clear before letting
 * go that every page will be deleted.
 */
export function WholePostOverlay({
  state,
  postId,
}: {
  state: WholePostState;
  postId: string | null;
}) {
  const { t } = useTranslation();
  if (!postId) return null;
  return (
    <div
      aria-hidden={state === null}
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-red-700/40 p-4 text-center"
      style={{
        opacity: state ? 1 : 0,
        transition: state === 'holding' ? `opacity ${String(HOLD_MS)}ms linear` : 'opacity 150ms',
      }}
      data-testid="whole-post-overlay"
      data-state={state ?? 'off'}
    >
      <span className="-rotate-6 rounded-lg border-4 border-red-500 bg-black/60 px-3 py-1 text-2xl font-black tracking-wider text-red-400 uppercase">
        {t('swipe.stamps.deletePost')}
      </span>
      <span className="rounded bg-black/60 px-2 py-0.5 text-sm font-medium text-white">
        {t('swipe.wholePostOf', { id: postId })}
      </span>
    </div>
  );
}
