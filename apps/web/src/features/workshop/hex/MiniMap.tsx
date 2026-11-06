import { useTranslation } from 'react-i18next';
import type { FileRegion } from '@conbert/core';
import { cn } from '@/lib/utils';
import { KIND_CLASS } from './regions';

/** Blocks smaller than this share of the file are left out (they'd be invisible anyway). */
const MIN_SHARE = 0.002;

/**
 * The whole file as a narrow strip: coloured blocks and where you are right
 * now. A click jumps there.
 */
export function MiniMap({
  regions,
  size,
  viewFrom,
  viewTo,
  height,
  onJump,
}: {
  regions: readonly FileRegion[];
  size: number;
  viewFrom: number;
  viewTo: number;
  height: number;
  onJump: (offset: number) => void;
}) {
  const { t } = useTranslation();
  if (size === 0) return null;
  const pct = (n: number) => `${(n / size) * 100}%`;
  const shown = regions.filter((r) => r.kind !== 'data' && (r.end - r.start) / size >= MIN_SHARE);
  return (
    <div
      role="presentation"
      title={t('workshop.hex.minimap')}
      className="relative hidden w-4 shrink-0 cursor-pointer overflow-hidden rounded border bg-muted/40 sm:block"
      style={{ height }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onJump(Math.floor(((event.clientY - rect.top) / rect.height) * size));
      }}
    >
      {shown.map((r) => (
        <div
          key={`${r.start}-${r.key}`}
          className={cn('absolute inset-x-0', KIND_CLASS[r.kind])}
          style={{ top: pct(r.start), height: `max(2px, ${pct(r.end - r.start)})` }}
        />
      ))}
      <div
        className="absolute inset-x-0 border-y-2 border-primary bg-primary/10"
        style={{ top: pct(viewFrom), height: `max(4px, ${pct(Math.max(1, viewTo - viewFrom))})` }}
      />
    </div>
  );
}
