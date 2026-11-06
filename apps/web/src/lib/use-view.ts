import { useCallback, useSyncExternalStore } from 'react';

/** The app's views. A tiny hash router is enough for now (#/compress, #/archive, #/download, #/booru, #/settings). */
export type View =
  | 'home'
  | 'compress'
  | 'archive'
  | 'download'
  | 'booru'
  | 'workflows'
  | 'workshop'
  | 'subscriptions'
  | 'swipe'
  | 'pdf'
  | 'admin'
  | 'help'
  | 'settings';

function readView(): View {
  if (window.location.hash === '#/help' || window.location.hash.startsWith('#/help/')) {
    return 'help';
  }
  if (window.location.hash === '#/workshop' || window.location.hash.startsWith('#/workshop/')) {
    return 'workshop';
  }
  switch (window.location.hash) {
    case '#/settings':
      return 'settings';
    case '#/compress':
      return 'compress';
    case '#/archive':
      return 'archive';
    case '#/download':
      return 'download';
    case '#/booru':
      return 'booru';
    case '#/workflows':
      return 'workflows';
    case '#/subscriptions':
      return 'subscriptions';
    case '#/swipe':
      return 'swipe';
    case '#/pdf':
      return 'pdf';
    case '#/admin':
      return 'admin';
    default:
      return 'home';
  }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

export function useView(): [View, (view: View) => void] {
  const view = useSyncExternalStore(subscribe, readView, () => 'home' as const);
  const navigate = useCallback((next: View) => {
    window.location.hash = next === 'home' ? '' : `#/${next}`;
  }, []);
  return [view, navigate];
}

/** The open workshop trick (#/workshop/<trick>), or null for the overview. */
function readTrick(): string | null {
  const match = /^#\/workshop\/([a-z0-9-]+)$/.exec(window.location.hash);
  return match?.[1] ?? null;
}

export function useWorkshopTrick(): [string | null, (trick: string | null) => void] {
  const trick = useSyncExternalStore(subscribe, readTrick, () => null);
  const open = useCallback((next: string | null) => {
    window.location.hash = next ? `#/workshop/${next}` : '#/workshop';
  }, []);
  return [trick, open];
}

/** The help article to open (#/help/<area>), or null for the whole help page. */
function readHelpArea(): string | null {
  const match = /^#\/help\/([a-z0-9-]+)$/.exec(window.location.hash);
  return match?.[1] ?? null;
}

export function useHelpArea(): string | null {
  return useSyncExternalStore(subscribe, readHelpArea, () => null);
}

/** Hash of the help article for an area – used by the "?" link of every view. */
export function helpHref(area: string): string {
  return `#/help/${area}`;
}
