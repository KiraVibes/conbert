import { useEffect, useState } from 'react';
import { ConversionError } from '@conbert/core';
import {
  convertForPreview,
  displayTarget,
  type PreviewKind,
  type PreviewSource,
} from './preview-source';

export type DisplayState =
  | { status: 'loading'; progress: number; converting: boolean }
  | { status: 'ready'; url: string; ext: string; blob: Blob }
  | { status: 'error'; messageKey: string; details?: string };

/**
 * An object URL the browser can show for the source – converted first if the
 * format can't be shown directly. The URL is freed when the view closes.
 */
export function useDisplayUrl(source: PreviewSource, kind: PreviewKind): DisplayState {
  const [state, setState] = useState<DisplayState>(() => ({
    status: 'loading',
    progress: 0,
    converting: displayTarget(kind, source.ext) !== null,
  }));

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    const targets = displayTarget(kind, source.ext);
    const show = (blob: Blob, ext: string) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setState({ status: 'ready', url, ext, blob });
    };
    if (!targets) {
      show(source.blob, source.ext);
    } else {
      convertForPreview(source, targets, (progress) => {
        if (!cancelled) setState({ status: 'loading', progress, converting: true });
      })
        .then(({ blob, ext }) => show(blob, ext))
        .catch((error: unknown) => {
          if (cancelled) return;
          const err: DisplayState = {
            status: 'error',
            messageKey:
              error instanceof ConversionError && error.messageKey !== 'errors.noRoute'
                ? error.messageKey
                : 'errors.previewUnavailable',
          };
          if (error instanceof Error) err.details = error.message;
          setState(err);
        });
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, kind]);

  return state;
}
