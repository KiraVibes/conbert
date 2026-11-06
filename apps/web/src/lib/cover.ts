import { useEffect, useState } from 'react';
import { getFormat } from '@conbert/core';

/**
 * A small cover picture for file cards: a frame of a video or the cover
 * inside a music file – made in the browser, nothing leaves the device.
 * Pictures don't need this (they show themselves).
 */

const SIZE = 320;
const covers = new WeakMap<Blob, Promise<string | null>>();

function canvasToUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.8),
  );
}

/** A frame shortly after the start (videos the browser can play). */
async function videoFrame(blob: Blob): Promise<string | null> {
  const source = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.src = source;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 8000);
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('cannot play'));
      };
    });
    const at = Number.isFinite(video.duration) ? Math.min(1, video.duration * 0.1) : 0;
    if (at > 0) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = at;
        setTimeout(resolve, 3000);
      });
    }
    const scale = Math.min(1, SIZE / Math.max(video.videoWidth, video.videoHeight, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await canvasToUrl(canvas);
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(source);
  }
}

/** The cover stored in a music file (MP3, M4A, FLAC, OGG …). */
async function musicCover(blob: Blob): Promise<string | null> {
  try {
    const { parseBlob } = await import('music-metadata');
    const meta = await parseBlob(blob, { duration: false, skipCovers: false });
    const picture = meta.common.picture?.[0];
    if (!picture) return null;
    return URL.createObjectURL(
      new Blob([picture.data as Uint8Array<ArrayBuffer>], { type: picture.format }),
    );
  } catch {
    return null;
  }
}

export function makeCover(blob: Blob, ext: string): Promise<string | null> {
  const cached = covers.get(blob);
  if (cached) return cached;
  const category = getFormat(ext)?.category;
  const promise =
    category === 'video'
      ? videoFrame(blob)
      : category === 'audio'
        ? musicCover(blob)
        : Promise.resolve(null);
  covers.set(blob, promise);
  return promise;
}

/** Cover for a card (null while loading or if there is none). */
export function useCover(blob: Blob | null, ext: string): string | null {
  const [url, setUrl] = useState<{ blob: Blob; url: string | null } | null>(null);
  useEffect(() => {
    if (!blob) return;
    let alive = true;
    void makeCover(blob, ext).then((cover) => alive && setUrl({ blob, url: cover }));
    return () => {
      alive = false;
    };
  }, [blob, ext]);
  return url && url.blob === blob ? url.url : null;
}
