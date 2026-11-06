import {
  ConversionError,
  describeEngine,
  findRoutes,
  getFormat,
  type Category,
} from '@conbert/core';
import { browserEngines } from '@/engines/registry';
import { THREE_READ } from '@/engines/three-formats';
import { runBrowserSteps } from '@/features/convert/run-conversion';

/** What a preview shows: the original file or a result. */
export interface PreviewSource {
  /** Stable key for caching preview conversions (file id + side). */
  key: string;
  blob: Blob;
  ext: string;
  name: string;
}

export type PreviewKind =
  | 'image'
  | 'svg'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'html'
  | 'text'
  | 'document'
  | 'model'
  | 'archive'
  | 'font'
  | 'table'
  | 'none';

/** Text-based documents: shown as highlighted source, rendering on request. */
export const TEXT_DOCUMENTS = new Set(['md', 'txt', 'tex', 'rst', 'org']);
/** Data as text: shown as highlighted source only. */
const DATA_TEXT = new Set(['json', 'yaml', 'toml', 'xml']);
/** Subtitles: shown as text, with their times. */
const SUBTITLE_TEXT = new Set(['srt', 'vtt', 'ass']);
/** Office formats only the server can open – no preview in the browser yet. */
const SERVER_ONLY_DOCUMENTS = new Set([
  'doc',
  'pptx',
  'ppt',
  'odp',
  'xls',
  'ods',
  'mobi',
  'azw3',
  'fb2',
]);

const IMG_NATIVE = new Set(['png', 'jpg', 'webp', 'gif', 'avif', 'bmp', 'ico']);

/** Which renderer a format gets. */
export function previewKind(ext: string): PreviewKind {
  if (ext === 'svg') return 'svg';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'html') return 'html';
  if (TEXT_DOCUMENTS.has(ext) || DATA_TEXT.has(ext) || SUBTITLE_TEXT.has(ext)) return 'text';
  if (ext === 'csv' || ext === 'xlsx') return 'table';
  if (SERVER_ONLY_DOCUMENTS.has(ext)) return 'none';
  const category: Category | undefined = getFormat(ext)?.category;
  switch (category) {
    case 'image':
      return 'image';
    case 'audio':
    case 'midi':
      return ext === 'sf2' || ext === 'sf3' || ext === 'dls' ? 'none' : 'audio';
    case 'video':
      return ext === 'gba' ? 'none' : 'video';
    case 'document':
    case 'ebook':
      return 'document';
    case '3d':
      return 'model';
    case 'archive':
      return 'archive';
    case 'font':
      return 'font';
    default:
      return 'none';
  }
}

function canPlay(tag: 'audio' | 'video', ext: string): boolean {
  const mime = getFormat(ext)?.mime;
  if (!mime || typeof document === 'undefined') return false;
  return document.createElement(tag).canPlayType(mime) !== '';
}

/**
 * Does the browser show this format directly? If not, the preview converts
 * it first (HEIC → PNG, AVI → MP4, MIDI → WAV …).
 */
export function displayTarget(kind: PreviewKind, ext: string): string[] | null {
  switch (kind) {
    case 'image':
      return IMG_NATIVE.has(ext) ? null : ['png'];
    case 'video':
      return canPlay('video', ext) ? null : ['mp4', 'webm'];
    case 'audio':
      if (ext === 'mid') return ['wav'];
      return canPlay('audio', ext) ? null : ['mp3', 'wav'];
    case 'document':
      return ['html'];
    case 'model':
      // three.js reads most formats itself; the rest becomes GLB first.
      return THREE_READ.includes(ext) ? null : ['glb'];
    default:
      return null;
  }
}

/**
 * Preview conversions run once per file, then come from here. Keyed by the
 * file itself, so the cache disappears together with the file.
 */
const cache = new WeakMap<Blob, Map<string, Promise<{ blob: Blob; ext: string }>>>();

/** Converts a file into something the browser can show, in the browser only. */
export function convertForPreview(
  source: PreviewSource,
  targets: readonly string[],
  onProgress: (percent: number) => void,
): Promise<{ blob: Blob; ext: string }> {
  const key = targets.join(',');
  let perFile = cache.get(source.blob);
  if (!perFile) {
    perFile = new Map();
    cache.set(source.blob, perFile);
  }
  const entries = perFile;
  let pending = entries.get(key);
  if (!pending) {
    pending = (async () => {
      let lastError: unknown = new ConversionError('errors.previewUnavailable');
      for (const target of targets) {
        for (const route of findRoutes(
          browserEngines.map(describeEngine),
          source.ext,
          target,
          'browser',
        )) {
          try {
            const blob = await runBrowserSteps(
              source.blob,
              route.steps,
              {},
              new AbortController().signal,
              (p) => onProgress(Math.round(p)),
            );
            return { blob, ext: target };
          } catch (error) {
            lastError = error;
          }
        }
      }
      throw lastError;
    })();
    entries.set(key, pending);
    // A failed attempt may succeed later (e.g. after an engine loaded).
    pending.catch(() => entries.delete(key));
  }
  return pending;
}
