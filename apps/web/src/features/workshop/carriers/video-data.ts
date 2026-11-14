import {
  assembleCarrier,
  blockLevels,
  frameBlocks,
  frameCapacity,
  frameColumns,
  readFrameBlocks,
  splitForCarrier,
  type AssembleResult,
  type CarriedFile,
  type FrameLayout,
} from '@conbert/core';

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const VIDEO_FPS = 30;
/** Biggest file for a data video (about 6 minutes at 8-pixel blocks). */
export const VIDEO_MAX_BYTES = 20 * 1024 * 1024;

export const layoutFor = (block: number): FrameLayout => ({
  width: VIDEO_WIDTH,
  height: VIDEO_HEIGHT,
  block,
});

/**
 * The file as a video: every frame carries one piece as black and white
 * blocks. Big blocks survive re-compression (e.g. by a video site) better,
 * small ones carry more.
 */
export async function makeDataVideo(
  file: CarriedFile,
  block: number,
  onProgress: (share: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const layout = layoutFor(block);
  const pieces = splitForCarrier(file, frameCapacity(layout));
  const mb = await import('mediabunny');
  const codec = await mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'vp8'], {
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
  });
  if (!codec) throw new Error('no video encoder');
  const mp4 = codec === 'avc' || codec === 'hevc';
  const output = new mb.Output({
    format: mp4 ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  const canvas = new OffscreenCanvas(VIDEO_WIDTH, VIDEO_HEIGHT);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  // A high bitrate keeps the block edges clean.
  const source = new mb.CanvasSource(canvas, { codec, bitrate: 12_000_000 });
  output.addVideoTrack(source, { frameRate: VIDEO_FPS });
  await output.start();
  const cols = frameColumns(layout);
  for (let f = 0; f < pieces.length; f++) {
    if (signal.aborted) {
      await output.cancel();
      throw new DOMException('aborted', 'AbortError');
    }
    const blocks = frameBlocks(pieces[f] ?? new Uint8Array(), layout);
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
    ctx.fillStyle = '#ebebeb';
    for (let i = 0; i < blocks.length; i++)
      if (blocks[i]) ctx.fillRect((i % cols) * block, Math.floor(i / cols) * block, block, block);
    await source.add(f / VIDEO_FPS, 1 / VIDEO_FPS);
    onProgress((f + 1) / pieces.length);
  }
  await output.finalize();
  const data = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
  if (!data) throw new Error('empty video');
  return new Blob([data], { type: mp4 ? 'video/mp4' : 'video/webm' });
}

/** Reads the pieces from every frame of a data video and puts the file together. */
export async function readDataVideo(
  file: Blob,
  onProgress: (share: number) => void,
): Promise<AssembleResult> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) return { ok: false, reason: 'none', missing: [], total: 0 };
  const duration = await track.computeDuration();
  const width = track.displayWidth;
  const height = track.displayHeight;
  const sink = new mb.CanvasSink(track, { poolSize: 2 });
  const pieces: Uint8Array[] = [];
  let layout: FrameLayout | null = null;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d canvas');
  for await (const frame of sink.canvases()) {
    ctx.drawImage(frame.canvas, 0, 0);
    const px = ctx.getImageData(0, 0, width, height).data;
    // The block size isn't stored – the first frame that reads tells it.
    const tries: FrameLayout[] = layout
      ? [layout]
      : [8, 16, 24].map((block) => ({ width, height, block }));
    for (const l of tries) {
      const piece = readFrameBlocks(blockLevels(px, width, l), l);
      if (piece) {
        layout = l;
        pieces.push(piece);
        break;
      }
    }
    if (duration > 0) onProgress(Math.min(1, frame.timestamp / duration));
  }
  return assembleCarrier(pieces);
}
