import type { BooruPost, SidecarKind } from '@conbert/core';
import { ProcessError, runProcess } from '../lib/run-process';

/**
 * Metadata of downloaded posts: source, artist and post link always go into
 * the file (if ExifTool can write that format), tags as keywords on request.
 * Sidecar files (.json, .txt) are written next to the picture.
 */

const WRITABLE = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'mp4', 'mov']);
/** IPTC keywords have a length limit and only exist in JPEG/TIFF. */
const IPTC = new Set(['jpg', 'jpeg', 'tif', 'tiff']);

let exiftoolMissing = false;

export function exiftoolArgs(post: BooruPost, file: string, keywords: boolean): string[] {
  const ext = (post.ext ?? '').toLowerCase();
  const args = ['-overwrite_original', '-q', '-q', '-m', '-charset', 'filename=utf8'];
  args.push(`-XMP-dc:Identifier=${post.postUrl}`);
  args.push(`-XMP-dc:Relation=${post.postUrl}`);
  if (post.source) args.push(`-XMP-dc:Source=${post.source}`);
  for (const artist of post.artists) args.push(`-XMP-dc:Creator=${artist}`);
  if (keywords) {
    for (const tag of post.tags) {
      args.push(`-XMP-dc:Subject=${tag}`);
      if (IPTC.has(ext) && tag.length <= 64) args.push(`-IPTC:Keywords=${tag}`);
    }
  }
  // The file always comes last, after "--" (a name can never become an option).
  args.push('--', file);
  return args;
}

/** Writes the metadata into the file. Never fails the download – returns whether it worked. */
export async function embedMetadata(
  post: BooruPost,
  file: string,
  keywords: boolean,
  signal?: AbortSignal,
): Promise<boolean> {
  if (exiftoolMissing || !WRITABLE.has((post.ext ?? '').toLowerCase())) return false;
  try {
    await runProcess('exiftool', exiftoolArgs(post, file, keywords), {
      timeoutMs: 60_000,
      ...(signal && { signal }),
    });
    return true;
  } catch (error) {
    if (error instanceof ProcessError && error.reason === 'spawn') exiftoolMissing = true;
    return false;
  }
}

export function sidecarContent(
  kind: Exclude<SidecarKind, 'embed'>,
  post: BooruPost,
  site: string,
): string {
  if (kind === 'txt') return post.tags.map((t) => t.replace(/_/g, ' ')).join(', ') + '\n';
  return (
    JSON.stringify(
      {
        site,
        id: post.id,
        postUrl: post.postUrl,
        source: post.source,
        md5: post.md5,
        rating: post.rating,
        score: post.score,
        favorites: post.favorites,
        width: post.width,
        height: post.height,
        createdAt: post.createdAt,
        artists: post.artists,
        characters: post.characters,
        copyrights: post.copyrights,
        tags: post.tags,
        fileUrl: post.fileUrl,
      },
      null,
      2,
    ) + '\n'
  );
}
