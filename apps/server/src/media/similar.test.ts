import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { MediaStatus, SimilarResponse, SimilarScan } from '@conbert/schemas';
import { hasCommand, setupAdmin, testApp } from '../test/helpers';
import { fingerprint } from './similar';

const hasRclone = hasCommand('rclone', ['version']);

/** A picture with shapes (so it has structure), as SVG → PNG. */
function svg(shapes: string, width = 600, height = 400): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 600 400">` +
      `<rect width="600" height="400" fill="#eee"/>${shapes}</svg>`,
  );
}
/** A photo-like picture: smooth light and colour changes everywhere. */
function photo(seed: number, width = 600, height = 400): Sharp {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const u = (x / width) * 6 + seed;
      const v = (y / height) * 4 - seed;
      pixels[i] = 128 + 100 * Math.sin(u + Math.cos(v * 1.3));
      pixels[i + 1] = 128 + 90 * Math.cos(v * 1.7 + u * 0.4);
      pixels[i + 2] = 128 + 80 * Math.sin(u * 0.7 - v);
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

const SUNSET =
  '<circle cx="150" cy="120" r="80" fill="#f80"/><rect x="0" y="260" width="600" height="140" fill="#246"/>';
const FOREST =
  '<rect x="60" y="40" width="120" height="320" fill="#060"/><rect x="380" y="100" width="160" height="200" fill="#a33"/>';

describe('fingerprints', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'conbert-fp-'));
    return () => rmSync(dir, { recursive: true, force: true });
  });

  it('stay close for copies and far for other pictures', async () => {
    const original = path.join(dir, 'a.png');
    const smallJpeg = path.join(dir, 'b.jpg');
    const other = path.join(dir, 'c.png');
    await sharp(svg(SUNSET)).png().toFile(original);
    await sharp(svg(SUNSET)).resize(200).jpeg({ quality: 40 }).toFile(smallJpeg);
    await sharp(svg(FOREST)).png().toFile(other);
    const [a, b, c] = await Promise.all([original, smallJpeg, other].map(fingerprint));
    expect(a).toMatchObject({ width: 600, height: 400 });
    expect(b).toMatchObject({ width: 200 });
    const { hashDistance } = await import('@conbert/core');
    expect(hashDistance(a?.hash ?? '', b?.hash ?? '')).toBeLessThanOrEqual(4);
    expect(hashDistance(a?.hash ?? '', c?.hash ?? '')).toBeGreaterThan(12);
  });

  it('work for photos: resized and recompressed copies match, other photos not', async () => {
    const files = ['p1.png', 'p1-small.jpg', 'p1-webp.webp', 'p2.png'].map((f) =>
      path.join(dir, f),
    );
    await photo(1)
      .png()
      .toFile(files[0] ?? '');
    await photo(1)
      .resize(240)
      .jpeg({ quality: 35 })
      .toFile(files[1] ?? '');
    await photo(1)
      .resize(420)
      .webp({ quality: 60 })
      .toFile(files[2] ?? '');
    await photo(2.5)
      .png()
      .toFile(files[3] ?? '');
    const [p1, small, webp, p2] = (await Promise.all(files.map(fingerprint))).map((f) => f.hash);
    const { hashDistance } = await import('@conbert/core');
    expect(hashDistance(p1 ?? '', small ?? '')).toBeLessThanOrEqual(4);
    expect(hashDistance(p1 ?? '', webp ?? '')).toBeLessThanOrEqual(4);
    expect(hashDistance(p1 ?? '', p2 ?? '')).toBeGreaterThan(12);
  });
});

describe.skipIf(!hasRclone)('similar pictures (real rclone)', () => {
  let app: FastifyInstance;
  let cookie: string;
  let dataDir: string;
  let storage: string;

  const api = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: { cookie },
      ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
    });

  async function put(rel: string, image: Sharp): Promise<void> {
    const full = path.join(storage, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    await image.toFile(full);
  }

  beforeEach(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-similar-'));
    storage = path.join(dataDir, 'storage');
    mkdirSync(storage);
    app = await testApp({ CONBERT_DATA_DIR: dataDir, CONBERT_STORAGE_ROOTS: storage });
    cookie = await setupAdmin(app);
    await api('POST', '/api/targets', {
      name: 'NAS',
      type: 'local',
      basePath: '',
      isDefault: true,
      usage: { asTarget: true, asSource: true },
      settings: { root: storage },
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('finds copies, keeps the best one first and deletes the rest via swipe', async () => {
    await put('Insta/sunset.png', sharp(svg(SUNSET)).png());
    await put('Insta/sunset-small.jpg', sharp(svg(SUNSET)).resize(300).jpeg({ quality: 50 }));
    await put('Other/sunset-copy.webp', sharp(svg(SUNSET)).resize(450).webp());
    await put('Insta/forest.png', sharp(svg(FOREST)).png());
    const broken = path.join(storage, 'Insta/broken.jpg');
    writeFileSync(broken, 'not a picture');
    await api('POST', '/api/media/sync');
    for (let i = 0; i < 100; i++) {
      if (!(await api('GET', '/api/media/status')).json<MediaStatus>().syncing) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const before = (await api('GET', '/api/media/similar')).json<SimilarResponse>();
    expect(before).toMatchObject({ hashed: 0, unhashed: 5, groups: [] });

    const started = await api('POST', '/api/media/similar/scan', { folders: [] });
    expect(started.json<SimilarScan>()).toMatchObject({ running: true, total: 5 });
    let result: SimilarResponse | undefined;
    for (let i = 0; i < 100; i++) {
      result = (await api('GET', '/api/media/similar')).json<SimilarResponse>();
      if (!result.scan.running) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(result?.scan).toMatchObject({ running: false, done: 5, failed: 1, error: null });
    expect(result?.unhashed).toBe(0);
    const [group] = result?.groups ?? [];
    expect(group?.map((i) => i.name)).toEqual([
      'sunset.png',
      'sunset-copy.webp',
      'sunset-small.jpg',
    ]);
    expect(group?.[0]).toMatchObject({ width: 600, height: 400, distance: 0 });

    // Only one folder: the copy in "Other" doesn't count there.
    const insta = (
      await api('GET', `/api/media/similar?folders=${encodeURIComponent('["Insta"]')}`)
    ).json<SimilarResponse>();
    expect(insta.groups[0]?.map((i) => i.name)).toEqual(['sunset.png', 'sunset-small.jpg']);

    // Delete the two worse copies like swiping left, then carry it out.
    for (const item of group?.slice(1) ?? []) {
      const res = await api('POST', '/api/swipe/action', { itemId: item.id, action: 'delete' });
      expect(res.statusCode, res.body).toBe(200);
    }
    await api('POST', '/api/swipe/flush');
    expect(existsSync(path.join(storage, 'Insta/sunset-small.jpg'))).toBe(false);
    expect(existsSync(path.join(storage, 'Other/sunset-copy.webp'))).toBe(false);
    expect(existsSync(path.join(storage, 'Insta/sunset.png'))).toBe(true);
    const after = (await api('GET', '/api/media/similar')).json<SimilarResponse>();
    expect(after.groups).toEqual([]);
  }, 60_000);
});
