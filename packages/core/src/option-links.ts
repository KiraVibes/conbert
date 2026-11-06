import type { EngineOption } from './engine';

/**
 * Options that depend on each other. While `key` has `value`, the options in
 * `set` are fixed to those values (shown, but locked). Turning `key` off again
 * gives them back their normal value.
 */
export interface OptionLink {
  key: string;
  value: unknown;
  set: Record<string, unknown>;
}

export const OPTION_LINKS: readonly OptionLink[] = [
  // Lossless ignores the quality anyway – show it honestly as 100.
  { key: 'lossless', value: true, set: { quality: 100 } },
];

/** Applies one change plus everything that follows from it. */
export function changeOption(
  values: Readonly<Record<string, unknown>>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  let next: Record<string, unknown> = { ...values, [key]: value };
  for (const link of OPTION_LINKS) {
    if (link.key !== key) continue;
    if (value === link.value) {
      next = { ...next, ...link.set };
    } else {
      // Back to normal: forget what the link had fixed.
      next = Object.fromEntries(Object.entries(next).filter(([k]) => !(k in link.set)));
    }
  }
  return next;
}

export interface LockedOption {
  value: unknown;
  /** The option that fixes it (for "fixed while … is on"). */
  by: string;
}

/** Options that another option currently fixes, with their fixed value. */
export function lockedOptions(
  options: readonly EngineOption[],
  values: Readonly<Record<string, unknown>>,
): Map<string, LockedOption> {
  const locked = new Map<string, LockedOption>();
  const present = new Set(options.map((o) => o.key));
  for (const link of OPTION_LINKS) {
    if (!present.has(link.key)) continue;
    const current = values[link.key] ?? options.find((o) => o.key === link.key)?.default;
    if (current !== link.value) continue;
    for (const [key, value] of Object.entries(link.set)) {
      if (present.has(key)) locked.set(key, { value, by: link.key });
    }
  }
  return locked;
}
