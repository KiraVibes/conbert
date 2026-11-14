import {
  TEST_BARS,
  encodeWavChannels,
  testFileChunks,
  testImagePixels,
  testToneChannels,
  type TestFill,
} from '@conbert/core';

/** A Blob of exactly `size` bytes, built in 1 MB pieces (no single huge buffer). */
export function sizedBlob(size: number, fill: TestFill): Blob {
  const parts: BlobPart[] = [];
  for (const chunk of testFileChunks(size, fill)) parts.push(chunk as Uint8Array<ArrayBuffer>);
  return new Blob(parts, { type: 'application/octet-stream' });
}

function canvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(width, height);
}

function label(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  width: number,
  y: number,
  size: number,
) {
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + size;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(width / 2 - w / 2, y - size * 0.75, w, size * 1.5);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, width / 2, y);
}

/** Test picture as PNG/JPG/WebP, with its size written in the middle. */
export async function testImage(
  width: number,
  height: number,
  type: 'image/png' | 'image/jpeg' | 'image/webp',
): Promise<Blob> {
  const c = canvas(width, height);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  ctx.putImageData(new ImageData(testImagePixels(width, height), width, height), 0, 0);
  label(
    ctx,
    `${width} × ${height}`,
    width,
    height * 0.475,
    Math.max(10, Math.round(height * 0.06)),
  );
  return c.convertToBlob({ type, quality: 0.92 });
}

export function testWav(kind: Parameters<typeof testToneChannels>[0], seconds: number): Blob {
  const bytes = encodeWavChannels(testToneChannels(kind, seconds), 44_100);
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
}

/** A PDF with numbered A4 pages (handy for page tools and printers). */
export async function testPdf(pages: number, title: string): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage([595.28, 841.89]);
    const { width, height } = page.getSize();
    const text = String(n);
    const size = 200;
    page.drawRectangle({
      x: 20,
      y: 20,
      width: width - 40,
      height: height - 40,
      borderColor: rgb(0.8, 0, 0),
      borderWidth: 2,
    });
    page.drawText(text, {
      x: (width - font.widthOfTextAtSize(text, size)) / 2,
      y: height / 2 - size / 3,
      size,
      font,
      color: rgb(0.2, 0.2, 0.3),
    });
    const footer = `${title} – ${n} / ${pages}`;
    page.drawText(footer, {
      x: (width - font.widthOfTextAtSize(footer, 12)) / 2,
      y: 40,
      size: 12,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  }
  const bytes = await doc.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}

/**
 * A test video (colour bars, running clock and frame number, one beep per
 * second) encoded by the browser (WebCodecs via mediabunny).
 */
export async function testVideo(
  seconds: number,
  width: number,
  height: number,
  container: 'mp4' | 'webm',
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<Blob> {
  const mb = await import('mediabunny');
  const fps = 30;
  const videoCodec = await mb.getFirstEncodableVideoCodec(
    container === 'mp4' ? ['avc', 'hevc', 'av1'] : ['vp9', 'vp8', 'av1'],
    { width, height },
  );
  const audioCodec = await mb.getFirstEncodableAudioCodec(
    container === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'],
  );
  if (!videoCodec) throw new Error('no video encoder');
  const output = new mb.Output({
    format: container === 'mp4' ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  const c = canvas(width, height);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas');
  const video = new mb.CanvasSource(c, { codec: videoCodec, quality: mb.QUALITY_MEDIUM });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = audioCodec
    ? new mb.AudioBufferSource({ codec: audioCodec, quality: mb.QUALITY_MEDIUM })
    : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const bars = testImagePixels(width, height);
  const background = new ImageData(bars, width, height);
  const frames = Math.round(seconds * fps);
  const textSize = Math.max(12, Math.round(height * 0.08));
  for (let f = 0; f < frames; f++) {
    if (signal.aborted) {
      await output.cancel();
      throw new DOMException('aborted', 'AbortError');
    }
    const t = f / fps;
    ctx.putImageData(background, 0, 0);
    // A box moving left to right once per second shows smooth (or jerky) playback.
    const bar = TEST_BARS[Math.floor(t) % TEST_BARS.length] ?? [255, 255, 255];
    const box = Math.round(height * 0.08);
    ctx.fillStyle = `rgb(${bar[0]},${bar[1]},${bar[2]})`;
    ctx.fillRect((t % 1) * (width - box), height * 0.62, box, box);
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = (t % 60).toFixed(2).padStart(5, '0');
    label(ctx, `${mm}:${ss}  ·  #${f + 1}`, width, height * 0.475, textSize);
    await video.add(t, 1 / fps);
    if (f % 15 === 0) onProgress(Math.round((f / frames) * 95));
  }
  if (audio) {
    const [left, right] = testToneChannels('beeps', seconds, 48_000);
    const buffer = new AudioBuffer({ numberOfChannels: 2, length: left.length, sampleRate: 48_000 });
    buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
    await audio.add(buffer);
  }
  await output.finalize();
  onProgress(100);
  const data = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
  if (!data) throw new Error('empty video');
  return new Blob([data], { type: container === 'mp4' ? 'video/mp4' : 'video/webm' });
}
