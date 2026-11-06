import { create } from 'zustand';
import { useSettings } from '@/features/settings/settings-store';

/**
 * The onboarding tour. Each step points at an element marked with
 * `data-tour="<target>"`; steps without a target (or whose element isn't on
 * the page) show in the middle of the screen.
 */
export const TOUR_STEPS = [
  { id: 'welcome' },
  { id: 'dropzone', target: 'dropzone' },
  { id: 'purpose', target: 'purpose' },
  { id: 'modes' },
  { id: 'nav', target: 'nav' },
  { id: 'expert', target: 'expert' },
  { id: 'help', target: 'help' },
] as const satisfies readonly { id: string; target?: string }[];

export type TourStep = (typeof TOUR_STEPS)[number];

/** i18n keys the tour needs (checked by a test). */
export function tourI18nKeys(): string[] {
  return TOUR_STEPS.flatMap((s) => [`tour.steps.${s.id}.title`, `tour.steps.${s.id}.body`]);
}

interface TourState {
  active: boolean;
  step: number;
  start: () => void;
  next: () => void;
  back: () => void;
  /** Ends the tour (finished or skipped) and remembers that it was seen. */
  stop: () => void;
}

export const useTour = create<TourState>()((set, get) => ({
  active: false,
  step: 0,
  start: () => set({ active: true, step: 0 }),
  next: () => {
    const { step } = get();
    if (step >= TOUR_STEPS.length - 1) get().stop();
    else set({ step: step + 1 });
  },
  back: () => set((s) => ({ step: Math.max(0, s.step - 1) })),
  stop: () => {
    set({ active: false, step: 0 });
    useSettings.getState().setTourSeen(true);
  },
}));
