import { describe, expect, it } from 'vitest';
import type { FormatSupport, Runtime } from './engine';
import { decideRoute, findRoutes, listTargets, type RoutableEngine } from './router';

const MB = 1024 * 1024;

function fmt(ext: string, canRead = true, canWrite = true): FormatSupport {
  return { ext, canRead, canWrite };
}

function engine(
  id: string,
  runtime: Runtime,
  formats: FormatSupport[],
  priority = 10,
  status: RoutableEngine['status'] = 'ready',
): RoutableEngine {
  return { id, runtime, formats, priority, status };
}

const vipsBrowser = engine('libvips', 'browser', [fmt('png'), fmt('jpg'), fmt('webp')], 20);
const magickBrowser = engine('imagemagick', 'browser', [fmt('png'), fmt('jpg'), fmt('bmp')], 10);
const officeServer = engine('libreoffice', 'server', [fmt('docx', true, false), fmt('pdf')], 10);
const pdfRender = engine('pdfjs', 'browser', [fmt('pdf', true, false), fmt('png', false, true)]);
const pdfServer = engine('pdf-render', 'server', [
  fmt('pdf', true, false),
  fmt('png', false, true),
]);
const sharpServer = engine('sharp', 'server', [fmt('png'), fmt('jpg'), fmt('webp')], 20);
const ffmpegBrowser = engine('ffmpeg', 'browser', [fmt('mp4'), fmt('webm')]);
const ffmpegServer = engine('ffmpeg', 'server', [fmt('mp4'), fmt('webm')]);

describe('findRoutes', () => {
  it('finds a direct route', () => {
    const routes = findRoutes([vipsBrowser], 'png', 'webp', 'browser');
    expect(routes).toEqual([
      {
        runtime: 'browser',
        steps: [{ engineId: 'libvips', runtime: 'browser', from: 'png', to: 'webp' }],
      },
    ]);
  });

  it('normalizes extensions and aliases', () => {
    const routes = findRoutes([vipsBrowser], '.PNG', 'JPEG', 'browser');
    expect(routes[0]?.steps[0]?.to).toBe('jpg');
  });

  it('lists all capable engines, highest priority first', () => {
    const routes = findRoutes([magickBrowser, vipsBrowser], 'png', 'jpg', 'browser');
    expect(routes.map((r) => r.steps[0]?.engineId)).toEqual(['libvips', 'imagemagick']);
  });

  it('returns nothing for same input and output format', () => {
    expect(findRoutes([vipsBrowser], 'png', 'png', 'browser')).toEqual([]);
  });

  it('ignores engines of the other runtime and engines in error state', () => {
    expect(findRoutes([sharpServer], 'png', 'webp', 'browser')).toEqual([]);
    const broken = engine('broken', 'browser', [fmt('png'), fmt('webp')], 99, 'error');
    expect(findRoutes([broken], 'png', 'webp', 'browser')).toEqual([]);
  });

  it('builds a chain when there is no direct way', () => {
    // bmp → (imagemagick) → png → (libvips) → webp
    const routes = findRoutes([vipsBrowser, magickBrowser], 'bmp', 'webp', 'browser');
    expect(routes).toHaveLength(1);
    expect(routes[0]?.steps.map((s) => [s.from, s.to, s.engineId])).toHaveLength(2);
    expect(routes[0]?.steps.at(-1)).toMatchObject({ to: 'webp', engineId: 'libvips' });
    expect(routes[0]?.steps[0]).toMatchObject({ from: 'bmp', engineId: 'imagemagick' });
  });

  it('builds a three-step chain within one runtime', () => {
    // docx → pdf → png → webp, all on the server
    const routes = findRoutes([officeServer, pdfServer, sharpServer], 'docx', 'webp', 'server');
    expect(routes[0]?.steps.map((s) => s.to)).toEqual(['pdf', 'png', 'webp']);
  });

  it('does not build chains longer than three steps', () => {
    const a = engine('a', 'browser', [fmt('f1', true, false), fmt('f2', false, true)]);
    const b = engine('b', 'browser', [fmt('f2', true, false), fmt('f3', false, true)]);
    const c = engine('c', 'browser', [fmt('f3', true, false), fmt('f4', false, true)]);
    const d = engine('d', 'browser', [fmt('f4', true, false), fmt('f5', false, true)]);
    expect(findRoutes([a, b, c, d], 'f1', 'f4', 'browser')).toHaveLength(1);
    expect(findRoutes([a, b, c, d], 'f1', 'f5', 'browser')).toEqual([]);
  });

  it('never mixes runtimes inside a chain', () => {
    // docx → pdf only exists on the server, pdf → png in the browser
    expect(findRoutes([officeServer, pdfRender], 'docx', 'png', 'browser')).toEqual([]);
    expect(findRoutes([officeServer, pdfRender], 'docx', 'png', 'server')).toEqual([]);
  });

  it('prefers the chain with the higher total priority', () => {
    const low = engine('low', 'browser', [fmt('a', true, false), fmt('mid1', false, true)], 1);
    const high = engine('high', 'browser', [fmt('a', true, false), fmt('mid2', false, true)], 50);
    const fromMid1 = engine('m1', 'browser', [fmt('mid1', true, false), fmt('z', false, true)], 10);
    const fromMid2 = engine('m2', 'browser', [fmt('mid2', true, false), fmt('z', false, true)], 10);
    const routes = findRoutes([low, high, fromMid1, fromMid2], 'a', 'z', 'browser');
    expect(routes[0]?.steps.map((s) => s.engineId)).toEqual(['high', 'm2']);
  });
});

describe('listTargets', () => {
  it('lists direct and chained targets with the fewest steps', () => {
    const targets = listTargets([vipsBrowser, magickBrowser], 'bmp', ['browser']);
    const byExt = Object.fromEntries(targets.map((t) => [t.ext, t]));
    expect(byExt['png']?.steps).toBe(1);
    expect(byExt['webp']?.steps).toBe(2);
    expect(byExt['bmp']).toBeUndefined();
  });

  it('merges runtimes', () => {
    const targets = listTargets([vipsBrowser, sharpServer], 'png', ['browser', 'server']);
    expect(targets.find((t) => t.ext === 'webp')?.runtimes.sort()).toEqual(['browser', 'server']);
  });

  it('only uses the requested runtimes', () => {
    const targets = listTargets([vipsBrowser, officeServer], 'docx', ['browser']);
    expect(targets).toEqual([]);
  });
});

describe('decideRoute', () => {
  const all = [vipsBrowser, sharpServer, officeServer, ffmpegBrowser, ffmpegServer];
  const base = { fileSize: 1 * MB, serverAvailable: true };

  it('local mode uses the browser', () => {
    const d = decideRoute(all, 'png', 'webp', { ...base, mode: 'local' });
    expect(d.route?.runtime).toBe('browser');
    expect(d.reason).toBe('modeLocal');
  });

  it('local mode explains when a format only works on the server', () => {
    const d = decideRoute(all, 'docx', 'pdf', { ...base, mode: 'local' });
    expect(d.route).toBeNull();
    expect(d.reason).toBe('onlyOnServer');
  });

  it('local mode warns about large files', () => {
    const d = decideRoute(all, 'png', 'webp', { ...base, mode: 'local', fileSize: 500 * MB });
    expect(d.route?.runtime).toBe('browser');
    expect(d.warnings).toEqual(['largeFileLocal']);
  });

  it('server mode uses the server', () => {
    const d = decideRoute(all, 'png', 'webp', { ...base, mode: 'server' });
    expect(d.route?.runtime).toBe('server');
    expect(d.reason).toBe('modeServer');
  });

  it('server mode reports an unreachable server', () => {
    const d = decideRoute(all, 'png', 'webp', { ...base, mode: 'server', serverAvailable: false });
    expect(d.route).toBeNull();
    expect(d.reason).toBe('serverUnavailable');
  });

  it('server mode explains when a format only works in the browser', () => {
    const browserOnly = engine('midi', 'browser', [
      fmt('mid', true, false),
      fmt('wav', false, true),
    ]);
    const d = decideRoute([browserOnly, sharpServer], 'mid', 'wav', { ...base, mode: 'server' });
    expect(d.reason).toBe('onlyInBrowser');
  });

  it('auto prefers the browser and keeps the server as alternative', () => {
    const d = decideRoute(all, 'png', 'webp', { ...base, mode: 'auto' });
    expect(d.route?.runtime).toBe('browser');
    expect(d.reason).toBe('autoBrowser');
    expect(d.alternatives.map((r) => r.runtime)).toContain('server');
  });

  it('auto switches to the server for large files', () => {
    const d = decideRoute(all, 'png', 'webp', { ...base, mode: 'auto', fileSize: 201 * MB });
    expect(d.route?.runtime).toBe('server');
    expect(d.reason).toBe('autoFileTooLarge');
  });

  it('auto respects a custom size threshold', () => {
    const d = decideRoute(all, 'png', 'webp', {
      ...base,
      mode: 'auto',
      fileSize: 20 * MB,
      autoServerThresholdBytes: 10 * MB,
    });
    expect(d.reason).toBe('autoFileTooLarge');
  });

  it('auto stays in the browser for large files when the server is down', () => {
    const d = decideRoute(all, 'png', 'webp', {
      ...base,
      mode: 'auto',
      fileSize: 500 * MB,
      serverAvailable: false,
    });
    expect(d.route?.runtime).toBe('browser');
    expect(d.warnings).toEqual(['largeFileLocal']);
  });

  it('auto uses the server for server-only formats', () => {
    const d = decideRoute(all, 'docx', 'pdf', { ...base, mode: 'auto' });
    expect(d.route?.runtime).toBe('server');
    expect(d.reason).toBe('autoServerOnly');
  });

  it('auto uses the GPU server for video', () => {
    const d = decideRoute(all, 'mp4', 'webm', {
      ...base,
      mode: 'auto',
      serverHasGpu: true,
      inputCategory: 'video',
    });
    expect(d.route?.runtime).toBe('server');
    expect(d.reason).toBe('autoGpuVideo');
  });

  it('reports when there is no way at all', () => {
    const d = decideRoute(all, 'png', 'docx', { ...base, mode: 'auto' });
    expect(d.route).toBeNull();
    expect(d.reason).toBe('noRoute');
  });

  it('auto reports a server-only format when the server is down', () => {
    const d = decideRoute(all, 'docx', 'pdf', { ...base, mode: 'auto', serverAvailable: false });
    expect(d.reason).toBe('serverUnavailable');
  });
});
