import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** How long to hold for the second meaning. */
export const HOLD_MS = 600;

/**
 * A round button: a press calls `onPress`, holding it for HOLD_MS calls
 * `onHold` instead (a ring fills up meanwhile). Without `onHold` it is a
 * normal button.
 */
export function HoldButton({
  onPress,
  onHold,
  className,
  children,
  ...rest
}: Omit<React.ComponentProps<typeof Button>, 'onClick'> & {
  onPress: () => void;
  onHold: (() => void) | null;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const stop = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };
  return (
    <Button
      {...rest}
      className={cn('relative touch-manipulation overflow-hidden select-none', className)}
      onPointerDown={(e) => {
        if (!onHold || e.button !== 0) return;
        held.current = false;
        setHolding(true);
        timer.current = window.setTimeout(() => {
          held.current = true;
          setHolding(false);
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
      {onHold && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full bg-current opacity-25"
          style={{
            transform: `scale(${holding ? 1 : 0})`,
            transition: holding ? `transform ${String(HOLD_MS)}ms linear` : 'none',
          }}
        />
      )}
      {children}
    </Button>
  );
}
