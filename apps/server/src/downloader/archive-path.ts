import path from 'node:path';
import type { AppContext } from '../context';

/**
 * The list of everything a user downloaded from a platform (outside of
 * subscriptions), so a second download of the same profile only loads what
 * is new. One file per user, tool and platform.
 */
export function downloadArchive(
  ctx: AppContext,
  userId: string,
  tool: 'yt-dlp' | 'gallery-dl',
  platform: string,
): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(
    ctx.config.dataDir,
    'archives',
    safe(userId),
    `${tool}-${safe(platform)}.${tool === 'gallery-dl' ? 'sqlite3' : 'txt'}`,
  );
}
