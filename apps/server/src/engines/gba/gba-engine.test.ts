import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GBA_MAX_ROM_BYTES, resolveGbaSettings } from '@conbert/core';
import { runProcess } from '../../lib/run-process';
import { hasCommand } from '../../test/helpers';
import { decodeRecords } from './codec';
import { estimateRomBytes, gbaVideoEngine } from './index';

const fixtures = path.join(import.meta.dirname, '../../__fixtures__');
const PLAYER = process.env['CONBERT_GBA_PLAYER'] ?? '/opt/conbert/gba/player.gba';

describe('estimateRomBytes', () => {
  it('grows with length, sharpness and sound', () => {
    const balanced = resolveGbaSettings({});
    const minute = estimateRomBytes(balanced, 60);
    expect(estimateRomBytes(balanced, 120)).toBeCloseTo(minute * 2);
    expect(estimateRomBytes(resolveGbaSettings({ gbaQuality: 'sharp' }), 60)).toBeGreaterThan(
      minute,
    );
    expect(estimateRomBytes(resolveGbaSettings({ removeAudio: true }), 60)).toBeLessThan(minute);
    // A typical 10-minute video does not fit in "balanced" quality.
    expect(estimateRomBytes(balanced, 600)).toBeGreaterThan(GBA_MAX_ROM_BYTES);
  });
});

const installed = hasCommand('ffmpeg') && hasCommand('ffprobe') && existsSync(PLAYER);

describe.skipIf(!installed)('video → GBA module (real ffmpeg + player)', () => {
  let workDir: string;
  beforeAll(async () => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'conbert-gba-'));
    await gbaVideoEngine.init();
  });
  afterAll(() => rmSync(workDir, { recursive: true, force: true }));

  function readModule(file: string) {
    const rom = new Uint8Array(readFileSync(file));
    const player = readFileSync(PLAYER);
    const base = Math.ceil(player.length / 256) * 256;
    const view = new DataView(rom.buffer);
    return {
      rom,
      base,
      magic: new TextDecoder().decode(rom.subarray(base, base + 4)),
      flags: view.getUint16(base + 6, true),
      width: view.getUint16(base + 8, true),
      height: view.getUint16(base + 10, true),
      frames: view.getUint32(base + 32, true),
      audioLength: view.getUint32(base + 44, true),
      title: new TextDecoder().decode(rom.subarray(0xa0, 0xac)).replace(/\0+$/, ''),
    };
  }

  it('is ready when ffmpeg and the player are installed', () => {
    expect(gbaVideoEngine.status()).toBe('ready');
  });

  it('turns an MP4 into a playable module with picture and sound', async () => {
    const percents: number[] = [];
    const output = await gbaVideoEngine.convert({
      input: path.join(fixtures, 'sample.mp4'),
      inputExt: 'mp4',
      outputExt: 'gba',
      options: { title: 'Urlaub 2026', gbaFps: '10' },
      workDir,
      onProgress: ({ percent }) => percents.push(percent),
    });
    const m = readModule(output as string);
    expect(m.magic).toBe('CGBV');
    expect(m.title).toBe('URLAUB 2026');
    expect([m.width, m.height]).toEqual([160, 104]);
    expect(m.frames).toBeGreaterThan(0);
    expect(m.flags & 1).toBe(1);
    expect(m.audioLength).toBeGreaterThan(1000);
    // The frames decode like on the GBA.
    const decoded = decodeRecords(m.rom.subarray(m.base + 64), m.frames, m.width, m.height);
    expect(decoded).toHaveLength(m.frames);
    expect(percents.at(-1)).toBe(100);
  }, 120_000);

  it('builds a silent module from an animated GIF', async () => {
    const output = await gbaVideoEngine.convert({
      input: path.join(fixtures, 'sample-animated.gif'),
      inputExt: 'gif',
      outputExt: 'gba',
      options: { gbaQuality: 'long' },
      workDir,
    });
    const m = readModule(output as string);
    expect([m.width, m.height]).toEqual([120, 80]);
    expect(m.flags & 1).toBe(0);
  }, 60_000);

  it('refuses videos that cannot fit on a module before encoding', async () => {
    const long = path.join(workDir, 'long.mp4');
    await runProcess('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=16x16:r=1',
      '-t',
      '3600',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      long,
    ]);
    const started = Date.now();
    await expect(
      gbaVideoEngine.convert({
        input: long,
        inputExt: 'mp4',
        outputExt: 'gba',
        options: {},
        workDir,
      }),
    ).rejects.toMatchObject({ messageKey: 'errors.gbaTooLong' });
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 120_000);
});
