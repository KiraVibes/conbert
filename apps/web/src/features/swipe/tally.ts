import { swipeActionSchema, type SwipeOutcome } from '@conbert/schemas';

/** Adds the successfully carried-out decisions to a tally. */
export function countDone(
  tally: Record<string, number>,
  done: readonly SwipeOutcome[],
): Record<string, number> {
  const next = { ...tally };
  for (const d of done) if (d.ok) next[d.action] = (next[d.action] ?? 0) + 1;
  return next;
}

/** "3 gelöscht, 1 behalten" – only the actions that really happened. */
export function doneList(
  t: (key: string, options: { count: number }) => string,
  counts: Record<string, number>,
): string {
  return swipeActionSchema.options
    .filter((a) => (counts[a] ?? 0) > 0)
    .map((a) => t(`swipe.done.${a}`, { count: counts[a] ?? 0 }))
    .join(', ');
}
