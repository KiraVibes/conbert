import { useEffect, useRef, useState } from 'react';
import { LayersIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePrefersReducedMotion } from '@/features/settings/use-apply-settings';
import { cn } from '@/lib/utils';

/** How long to hold for the second meaning. */
export const HOLD_MS = 600;

/** The ring around the button (SVG units; the button is 56 px). */
const RING_R = 32;
const RING_LENGTH = 2 * Math.PI * RING_R;

/**
 * A round button: a press calls `onPress`, holding it for HOLD_MS calls
 * `onHold` instead. While held, a ring around it fills up (bigger than the
 * button, so a finger doesn't hide all of it); a short vibration confirms.
 * Without `onHold` it is a normal button. A small badge says that holding
 * does something here (`holdBadge`).
 */
export function HoldButton({
  onPress,
  onHold,
  onHoldChange,
  holdBadge,
  className,
  children,
  ...rest
}: Omit<React.ComponentProps<typeof Button>, 'onClick'> & {
  onPress: () => void;
  onHold: (() => void) | null;
  /** true while held (before it fires), false when let go or fired. */
  onHoldChange?: (holding: boolean) => void;
  /** Title of the badge that shows holding works here. */
  holdBadge?: string;
}) {
  const still = usePrefersReducedMotion();
  const [holding, setHolding] = useState(false);
  const [fired, setFired] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const firedTimer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(firedTimer.current);
    },
    [],
  );
  const stop = () => {
    window.clearTimeout(timer.current);
    if (holding) onHoldChange?.(false);
    setHolding(false);
  };
  return (
    <span
      className={cn(
        'relative inline-flex rounded-full',
        !still && 'transition-transform duration-150',
        holding && !still && 'scale-110',
      )}
    >
      <Button
        {...rest}
        className={cn('touch-manipulation select-none', holding && 'bg-red-500/15', className)}
        onPointerDown={(e) => {
          if (!onHold || e.button !== 0) return;
          held.current = false;
          setHolding(true);
          onHoldChange?.(true);
          timer.current = window.setTimeout(() => {
            held.current = true;
            setHolding(false);
            onHoldChange?.(false);
            setFired(true);
            firedTimer.current = window.setTimeout(() => setFired(false), 400);
            try {
              navigator.vibrate?.(30);
            } catch {
              // No vibration on this device.
            }
            onHold();
          }, HOLD_MS);
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        // Phones open a menu on a long press – not here.
        onContextMenu={(e) => {
          if (onHold) e.preventDefault();
        }}
        onClick={() => {
          if (held.current) {
            held.current = false;
            return;
          }
          onPress();
        }}
      >
        {children}
      </Button>
      {onHold && (
        <svg
          aria-hidden="true"
          viewBox="0 0 72 72"
          className="pointer-events-none absolute -inset-2 size-[calc(100%+1rem)] -rotate-90 text-red-500"
          data-testid="hold-ring"
          data-holding={holding || fired}
        >
          <circle
            cx="36"
            cy="36"
            r={RING_R}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={holding || fired ? 0 : RING_LENGTH}
            style={{
              opacity: holding || fired ? 1 : 0,
              transition: holding
                ? `stroke-dashoffset ${String(HOLD_MS)}ms linear`
                : 'stroke-dashoffset 0s, opacity 200ms',
            }}
          />
        </svg>
      )}
      {onHold && holdBadge && (
        <span
          className="pointer-events-none absolute -top-1 -right-1 rounded-full bg-red-500 p-1 text-white shadow"
          title={holdBadge}
          aria-hidden="true"
        >
          <LayersIcon className="size-3" />
        </span>
      )}
    </span>
  );
}
