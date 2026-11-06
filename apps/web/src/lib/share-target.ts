/**
 * "Share → Conbert" on a phone: the installed app is opened at
 * /share?title=…&text=…&url=…. Apps put the link in different fields
 * (Instagram in "text", the browser in "url"), so the first web address in
 * any of them wins. It is handed to the downloader page.
 */

const KEY = 'conbert-shared-link';

export function linkFromShare(params: URLSearchParams): string | null {
  for (const field of ['url', 'text', 'title']) {
    const value = params.get(field);
    const match = value ? /https?:\/\/[^\s<>"']+/i.exec(value) : null;
    if (match) return match[0].replace(/[),.;!?]+$/, '');
  }
  return null;
}

/** Call once at start: turns /share?… into the downloader with the link. */
export function takeSharedLink(location: Location, history: History): void {
  if (location.pathname !== '/share') return;
  const link = linkFromShare(new URLSearchParams(location.search));
  try {
    if (link) sessionStorage.setItem(KEY, link);
  } catch {
    // Private mode: the link is just not carried over.
  }
  history.replaceState(null, '', link ? '/#/download' : '/');
}

/** The shared link waiting for the downloader (read once). */
export function pendingSharedLink(): string | null {
  try {
    const link = sessionStorage.getItem(KEY);
    if (link) sessionStorage.removeItem(KEY);
    return link;
  } catch {
    return null;
  }
}

/**
 * Lets the browser offer "Install app" (needed for the share menu) and keeps
 * the app for offline use (public/sw.js). Only in real builds: the dev server
 * has no offline manifest and changes files all the time.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
    console.warn('service worker not registered', error);
  });
}
