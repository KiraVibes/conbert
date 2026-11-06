import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { getFormat } from '@conbert/core';
import type { Config } from '../config';
import { FFMPEG } from '../engines/ffmpeg';
import { runProcess } from '../lib/run-process';

/**
 * Small preview pictures for the tiles of downloaded files: the cover the
 * site offers (yt-dlp), else the picture itself, a frame of the video or the
 * cover inside a music file. Kept as long as the download stays in the list.
 */

const SIZE = 360;

export function thumbnailPath(config: Config, fileId: string): string {
  return path.join(config.dataDir, 'thumbs', `${fileId}.jpg`);
}

/** A picture to start from: the given one, or one taken out of the file with ffmpeg. */
async function sourcePicture(
  file: string,
  ext: string,
  preferred: string | null,
  scratch: string,
): Promise<string | null> {
  if (preferred) return preferred;
  const category = getFormat(ext)?.category;
  if (category === 'image') return file;
  if (category !== 'video' && category !== 'audio') return null;
  const out = path.join(scratch, `${randomUUID()}.png`);
  // Videos: a frame after one second (short clips: the first). Music: the cover.
  const tries =
    category === 'video'
      ? [
          ['-ss', '1', '-i', file],
          ['-i', file],
        ]
      : [['-i', file, '-an']];
  for (const input of tries) {
    try {
      await runProcess(FFMPEG, ['-v', 'error', ...input, '-frames:v', '1', '-y', out], {
        timeoutMs: 60_000,
      });
      // Past the end (clips under a second) ffmpeg succeeds without writing anything.
      if ((await stat(out).catch(() => null))?.size) return out;
    } catch {
      // next try
    }
  }
  return null;
}

/** Makes the preview picture; false if the file has nothing to show. */
export async function makeThumbnail(
  config: Config,
  fileId: string,
  file: string,
  ext: string,
  preferred: string | null,
): Promise<boolean> {
  const scratch = path.join(config.dataDir, 'tmp');
  await mkdir(path.join(config.dataDir, 'thumbs'), { recursive: true });
  await mkdir(scratch, { recursive: true });
  const source = await sourcePicture(file, ext, preferred, scratch);
  if (!source) return false;
  try {
    await sharp(source, { failOn: 'none', animated: false })
      .rotate()
      .resize({ width: SIZE, height: SIZE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true })
      .toFile(thumbnailPath(config, fileId));
    return true;
  } catch {
    return false;
  } finally {
    if (source !== file && source !== preferred) await rm(source, { force: true });
  }
}

export async function removeThumbnails(config: Config, fileIds: string[]): Promise<void> {
  await Promise.all(fileIds.map((id) => rm(thumbnailPath(config, id), { force: true })));
}
