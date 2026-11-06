import { useEffect, useState } from 'react';

export interface PreviewState<T> {
  result: T | null;
  working: boolean;
  failed: boolean;
}

/**
 * Runs `work` a moment after the inputs stop changing (sliders move fast) and
 * keeps the newest result. Older runs that finish late are ignored.
 * `key` must change whenever the inputs do; `dispose` frees an old result.
 */
export function usePreview<T>(
  key: string | null,
  work: () => Promise<T | null>,
  dispose?: (old: T) => void,
  delay = 250,
): PreviewState<T> {
  /** `key` = the inputs the shown result belongs to. */
  const [state, setState] = useState<{ key: string | null; result: T | null; failed: boolean }>({
    key: null,
    result: null,
    failed: false,
  });

  useEffect(() => {
    if (!key) return;
    let active = true;
    const timer = setTimeout(() => {
      work()
        .then((result) => {
          if (!active) {
            if (result && dispose) dispose(result);
            return;
          }
          setState((s) => ({ key, result: result ?? s.result, failed: result === null }));
        })
        .catch(() => active && setState((s) => ({ ...s, key, failed: true })));
    }, delay);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // `work` changes on every render; the key stands for its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Free the previous result when a new one arrives, and the last one on leaving.
  useEffect(
    () => () => {
      if (state.result && dispose) dispose(state.result);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.result],
  );

  if (!key) return { result: null, working: false, failed: false };
  // Until the newest inputs are done, the older result stays visible.
  const done = state.key === key;
  return { result: state.result, working: !done, failed: done && state.failed };
}

/** "foto.jpg" → "foto-pixel.png". */
export function outName(file: File, suffix: string, ext: string): string {
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}-${suffix}.${ext}`;
}

/** Blob results as object URLs, freed again by usePreview. */
export const revoke = (r: { url: string }) => URL.revokeObjectURL(r.url);
