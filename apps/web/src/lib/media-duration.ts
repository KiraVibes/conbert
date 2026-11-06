/**
 * Length of a video or song in seconds – needed to hit a target size.
 * mediabunny reads the container; the browser's own player is the fallback.
 */
export async function mediaDuration(file: Blob): Promise<number | null> {
  try {
    const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    const seconds = await input.computeDuration();
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  } catch {
    // Unknown container – ask the browser.
  }
  return new Promise((resolve) => {
    const media = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    media.preload = 'metadata';
    media.onloadedmetadata = () => done(Number.isFinite(media.duration) ? media.duration : null);
    media.onerror = () => done(null);
    media.src = url;
  });
}
