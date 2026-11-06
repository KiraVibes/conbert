import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PreviewLoading, PreviewProblem } from './PreviewStatus';
import type { PreviewSource } from './preview-source';
import { useDisplayUrl } from './use-display-url';

const CHECKERBOARD =
  'bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px]';

/**
 * Before/after slider: both pictures fill the same area, the result is cut
 * off at the slider position. Works with the keyboard via the range input.
 */
export function ComparePreview({ before, after }: { before: PreviewSource; after: PreviewSource }) {
  const { t } = useTranslation();
  const left = useDisplayUrl(before, 'image');
  const right = useDisplayUrl(after, 'image');
  const [position, setPosition] = useState(50);
  const [pixelated, setPixelated] = useState(false);

  for (const state of [left, right]) {
    if (state.status === 'loading') return <PreviewLoading state={state} />;
    if (state.status === 'error') return <PreviewProblem state={state} />;
  }
  if (left.status !== 'ready' || right.status !== 'ready') return null;

  // Small pictures are enlarged; show their pixels sharply instead of blurred.
  const image = 'absolute inset-0 h-full w-full object-contain';
  const style = { imageRendering: pixelated ? ('pixelated' as const) : ('auto' as const) };

  return (
    <div className="space-y-2" data-testid="compare-preview">
      <div className={`relative h-[60vh] overflow-hidden rounded-md border ${CHECKERBOARD}`}>
        <img
          src={left.url}
          alt={t('preview.before')}
          className={image}
          style={style}
          onLoad={(e) =>
            setPixelated(e.currentTarget.naturalWidth < e.currentTarget.clientWidth / 2)
          }
        />
        <img
          src={right.url}
          alt={t('preview.after')}
          className={image}
          style={{ ...style, clipPath: `inset(0 0 0 ${position}%)` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ left: `${position}%` }}
          aria-hidden="true"
        />
        <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
          {t('preview.before')}
        </span>
        <span className="absolute top-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
          {t('preview.after')}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(e) => setPosition(Number(e.target.value))}
        className="w-full accent-primary"
        aria-label={t('preview.compareSlider')}
      />
    </div>
  );
}
