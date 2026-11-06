import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/features/settings/settings-store';
import { useSettingsReady } from '@/features/settings/use-settings-sync';
import { useView } from '@/lib/use-view';
import { TOUR_STEPS, useTour } from './tour-store';

const CARD_WIDTH = 340;
const GAP = 12;
const PAD = 6;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Where the highlighted element is on screen (null = show the card centred). */
function useTargetBox(target: string | undefined, step: number): Box | null {
  const [box, setBox] = useState<Box | null>(null);

  const measure = useCallback(() => {
    const el = target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;
    if (!el) return setBox(null);
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return setBox(null);
    setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [target]);

  useLayoutEffect(() => {
    const el = target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null;
    el?.scrollIntoView({ block: 'center', inline: 'nearest' });
    // Measure after the scroll has been applied.
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [target, step, measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  return box;
}

/** Card position: below the element if there's room, else above; centred without element. */
function cardStyle(box: Box | null): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_WIDTH, vw - 32);
  if (!box) {
    return { width, left: (vw - width) / 2, top: Math.max(16, vh / 2 - 120) };
  }
  const left = Math.min(Math.max(16, box.left + box.width / 2 - width / 2), vw - width - 16);
  const below = box.top + box.height + GAP;
  if (below + 200 < vh) return { width, left, top: below };
  return { width, left, bottom: Math.max(16, vh - box.top + GAP) };
}

/** Starts the tour once for new accounts, as soon as their settings are known. */
function useAutoStart() {
  const ready = useSettingsReady((s) => s.ready);
  const seen = useSettings((s) => s.tourSeen);
  const [view] = useView();
  const start = useTour((s) => s.start);
  useEffect(() => {
    if (ready && !seen && view === 'home' && !useTour.getState().active) start();
  }, [ready, seen, view, start]);
}

/** The onboarding tour overlay. Skippable, keyboard friendly, respects reduced motion. */
export function Tour() {
  const { t } = useTranslation();
  useAutoStart();
  const { active, step, next, back, stop } = useTour();
  const current = TOUR_STEPS[step];
  const target = current && 'target' in current ? current.target : undefined;
  const box = useTargetBox(active ? target : undefined, step);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) cardRef.current?.focus();
  }, [active, step]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
      else if (e.key === 'Tab' && cardRef.current) {
        // Keep keyboard focus inside the tour card while it's open.
        const items = [...cardRef.current.querySelectorAll<HTMLElement>('button')];
        const first = items[0];
        const lastItem = items.at(-1);
        if (!first || !lastItem) return;
        const inside = cardRef.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          lastItem.focus();
        } else if (!e.shiftKey && (document.activeElement === lastItem || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, next, back, stop]);

  if (!active || !current) return null;
  const last = step === TOUR_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50" data-testid="tour">
      {/* Dimmed page with a hole around the highlighted element. Clicks outside end nothing. */}
      {box ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-lg transition-all duration-200 motion-reduce:transition-none"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
            // A clear frame around the element (also visible on the dark theme), the rest dimmed.
            boxShadow: '0 0 0 3px var(--primary), 0 0 0 9999px rgb(0 0 0 / 0.6)',
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-black/60" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="fixed rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg focus-visible:outline-none"
        style={cardStyle(box)}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <h2 id="tour-title" className="font-heading text-base font-semibold">
            {t(`tour.steps.${current.id}.title`)}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="-mt-1 -mr-1 size-7"
            onClick={stop}
            aria-label={t('tour.skip')}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
        <p id="tour-body" className="text-sm leading-relaxed text-muted-foreground">
          {t(`tour.steps.${current.id}.body`)}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('tour.progress', { step: step + 1, total: TOUR_STEPS.length })}
          </span>
          <div className="flex gap-2">
            {step > 0 ? (
              <Button variant="outline" size="sm" onClick={back}>
                {t('tour.back')}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={stop}>
                {t('tour.skip')}
              </Button>
            )}
            <Button size="sm" onClick={next}>
              {last ? t('tour.done') : t('tour.next')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
