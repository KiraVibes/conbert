/**
 * Short date and time for cards: "12.11., 14:03" (with the year when it is not
 * this year), so you can see when something happened.
 */
export function stamp(iso: string, language: string, now = new Date()): string {
  const date = new Date(iso);
  return date.toLocaleString(language, {
    day: '2-digit',
    month: '2-digit',
    ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The full date and time, for a tooltip. */
export function fullStamp(iso: string, language: string): string {
  return new Date(iso).toLocaleString(language, { dateStyle: 'full', timeStyle: 'medium' });
}

/** Label for a download or crawl card: started, downloaded or ended – by a subscription or not. */
export function cardTimeKey(status: string, bySubscription: boolean): string {
  if (status === 'done') return bySubscription ? 'cardTime.feedDone' : 'cardTime.done';
  if (status === 'error' || status === 'cancelled') return 'cardTime.ended';
  return bySubscription ? 'cardTime.feedStarted' : 'cardTime.started';
}
