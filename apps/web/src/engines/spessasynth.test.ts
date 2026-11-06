// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BasicSoundBank } from 'spessasynth_core';
import { describe, expect, it } from 'vitest';
import { ConversionError, engineI18nKeys, getFormat } from '@conbert/core';
import { findMissingKeys } from '@conbert/i18n';
import { convertSoundBank, loadSoundBank, renderMidi } from './spessasynth-convert';
import { SPESSASYNTH_MIDI_META, SPESSASYNTH_SOUNDFONT_META } from './spessasynth-definition';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(import.meta.dirname, '__fixtures__', name)));
// A tiny saw-wave bank instead of the 32 MB GeneralUser GS.
const testBank = () =>
  Promise.resolve(loadSoundBank(new Uint8Array(BasicSoundBank.getSampleSoundBankFile())));
const ascii = (data: Uint8Array, from: number, to: number) =>
  new TextDecoder().decode(data.subarray(from, to));

describe('spessasynth definitions', () => {
  it('have texts and registry entries', () => {
    for (const meta of [SPESSASYNTH_MIDI_META, SPESSASYNTH_SOUNDFONT_META]) {
      expect(findMissingKeys(engineI18nKeys(meta))).toEqual([]);
      for (const f of meta.formats) expect(getFormat(f.ext), f.ext).toBeDefined();
    }
  });
});

describe('renderMidi', () => {
  it('records a MIDI file as a WAV of the right length', async () => {
    const seen: number[] = [];
    const wav = await renderMidi(fixture('sample.mid'), testBank, (p) => seen.push(p));
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 12)).toBe('WAVE');
    // 2 s of notes + 2 s tail, 16-bit stereo at 44.1 kHz ≈ 705 KB.
    const seconds = (wav.byteLength - 44) / (44_100 * 2 * 2);
    expect(seconds).toBeGreaterThan(3.5);
    expect(seconds).toBeLessThan(4.5);
    expect(seen.at(-1)).toBe(97);
    // Not silent: some samples away from zero.
    const samples = new Int16Array(wav.buffer, wav.byteOffset + 44, 20_000);
    expect(samples.some((s) => Math.abs(s) > 1000)).toBe(true);
  });

  it('rejects files that are not MIDI', async () => {
    await expect(renderMidi(fixture('sample.png'), testBank, () => undefined)).rejects.toThrow(
      ConversionError,
    );
  });
});

describe('convertSoundBank', () => {
  it('converts SF2 → DLS and DLS → SF2', () => {
    const dls = convertSoundBank(fixture('sample.sf2'), 'dls');
    expect(ascii(dls, 8, 12)).toBe('DLS ');
    const sf2 = convertSoundBank(dls, 'sf2');
    expect(ascii(sf2, 8, 12)).toBe('sfbk');
    expect(loadSoundBank(sf2).presets.length).toBeGreaterThan(0);
  });

  it('cannot write SF3', () => {
    expect(() => convertSoundBank(fixture('sample.sf2'), 'sf3')).toThrow(ConversionError);
  });
});

const generalUser = path.resolve(import.meta.dirname, '../../public/soundfonts/GeneralUser-GS.sf2');
describe.skipIf(!existsSync(generalUser))('GeneralUser GS (downloaded by fetch-soundfont)', () => {
  it('loads and renders the piano', async () => {
    const bank = loadSoundBank(new Uint8Array(readFileSync(generalUser)));
    expect(bank.presets.length).toBeGreaterThan(200);
    const wav = await renderMidi(
      fixture('sample.mid'),
      () => Promise.resolve(bank),
      () => undefined,
    );
    const samples = new Int16Array(wav.buffer, wav.byteOffset + 44, 40_000);
    expect(samples.some((s) => Math.abs(s) > 1000)).toBe(true);
  }, 30_000);
});
