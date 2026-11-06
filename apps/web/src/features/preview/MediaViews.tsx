import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PreviewLoading, PreviewProblem } from './PreviewStatus';
import type { PreviewSource } from './preview-source';
import { useDisplayUrl } from './use-display-url';

/** Native audio controls (keyboard accessible) plus a clickable waveform. */
export function AudioPreview({ source }: { source: PreviewSource }) {
  const { t } = useTranslation();
  const display = useDisplayUrl(source, 'audio');
  const audio = useRef<HTMLAudioElement>(null);
  const wave = useRef<HTMLDivElement>(null);
  const url = display.status === 'ready' ? display.url : null;

  useEffect(() => {
    const media = audio.current;
    const container = wave.current;
    if (!url || !media || !container) return;
    let destroyed = false;
    let instance: { destroy(): void } | null = null;
    void import('wavesurfer.js').then(({ default: WaveSurfer }) => {
      if (destroyed) return;
      const styles = getComputedStyle(document.documentElement);
      instance = WaveSurfer.create({
        container,
        media,
        height: 96,
        waveColor: styles.getPropertyValue('--muted-foreground').trim() || '#888',
        progressColor: styles.getPropertyValue('--primary').trim() || '#6d28d9',
        cursorWidth: 2,
        barWidth: 2,
        barGap: 1,
      });
    });
    return () => {
      destroyed = true;
      instance?.destroy();
    };
  }, [url]);

  if (display.status === 'loading') return <PreviewLoading state={display} />;
  if (display.status === 'error') return <PreviewProblem state={display} />;
  return (
    <div className="space-y-3 rounded-md border p-4" data-testid="audio-preview">
      <div ref={wave} aria-hidden="true" />
      <audio
        ref={audio}
        src={display.url}
        controls
        className="w-full"
        aria-label={t('preview.player')}
      />
    </div>
  );
}

const THUMBNAILS = 8;

/** Takes evenly spaced still images from a video (for the strip below the player). */
async function captureThumbnails(
  url: string,
  count: number,
): Promise<{ time: number; url: string }[]> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('video'));
  });
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (duration <= 0 || video.videoWidth === 0) return [];
  const canvas = document.createElement('canvas');
  canvas.height = 72;
  canvas.width = Math.round((72 * video.videoWidth) / video.videoHeight);
  const context = canvas.getContext('2d');
  if (!context) return [];
  const result: { time: number; url: string }[] = [];
  for (let k = 0; k < count; k++) {
    const time = (duration * (k + 0.5)) / count;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      video.currentTime = time;
    });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.7),
    );
    if (blob) result.push({ time, url: URL.createObjectURL(blob) });
  }
  video.removeAttribute('src');
  video.load();
  return result;
}

export function VideoPreview({ source }: { source: PreviewSource }) {
  const { t } = useTranslation();
  const display = useDisplayUrl(source, 'video');
  const player = useRef<HTMLVideoElement>(null);
  const [thumbnails, setThumbnails] = useState<{ time: number; url: string }[]>([]);
  const url = display.status === 'ready' ? display.url : null;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let made: { url: string }[] = [];
    captureThumbnails(url, THUMBNAILS)
      .then((list) => {
        made = list;
        if (!cancelled) setThumbnails(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      made.forEach((m) => URL.revokeObjectURL(m.url));
    };
  }, [url]);

  if (display.status === 'loading') return <PreviewLoading state={display} />;
  if (display.status === 'error') return <PreviewProblem state={display} />;
  return (
    <div className="space-y-2" data-testid="video-preview">
      <video
        ref={player}
        src={display.url}
        controls
        className="max-h-[55vh] w-full rounded-md border bg-black"
        aria-label={t('preview.player')}
      />
      {thumbnails.length > 0 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {thumbnails.map((thumb) => (
            <button
              key={thumb.time}
              type="button"
              className="shrink-0 overflow-hidden rounded border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => {
                if (player.current) player.current.currentTime = thumb.time;
              }}
              aria-label={t('preview.jumpTo', { seconds: Math.round(thumb.time) })}
            >
              <img src={thumb.url} alt="" className="h-12" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
