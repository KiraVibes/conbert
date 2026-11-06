import { describe, expect, it } from 'vitest';
import { carrierCapacity, hideInCarrier, peekCarrier, revealFromCarrier } from './stego';
import { parseWav, wavCarrier, wavDuration } from './wav';

/** A small WAV: a sine tone, plus a LIST chunk after the samples. */
function makeWav(bits: 8 | 16 | 24 | 32, float = false, frames = 4000, channels = 2): Uint8Array {
  const step = bits / 8;
  const dataLength = frames * channels * step;
  const list = new TextEncoder().encode('LIST\x04\x00\x00\x00INFO');
  const out = new Uint8Array(44 + dataLength + list.length);
  const v = new DataView(out.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  put(0, 'RIFF');
  v.setUint32(4, out.length - 8, true);
  put(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, float ? 3 : 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000 * channels * step, true);
  v.setUint16(32, channels * step, true);
  v.setUint16(34, bits, true);
  put(36, 'data');
  v.setUint32(40, dataLength, true);
  for (let i = 0; i < frames * channels; i++) {
    const x = Math.sin(i / 7) * 0.5;
    const at = 44 + i * step;
    if (float) v.setFloat32(at, x, true);
    else if (bits === 8) out[at] = 128 + Math.round(x * 127);
    else if (bits === 16) v.setInt16(at, Math.round(x * 32767), true);
    else if (bits === 24) {
      const n = Math.round(x * 8388607);
      out[at] = n & 255;
      out[at + 1] = (n >> 8) & 255;
      out[at + 2] = (n >> 16) & 255;
    } else v.setInt32(at, Math.round(x * 2147483647), true);
  }
  out.set(list, 44 + dataLength);
  return out;
}

describe('WAV steganography', () => {
  it('reads the format', () => {
    const info = parseWav(makeWav(16));
    expect(info).toMatchObject({ channels: 2, sampleRate: 8000, bitsPerSample: 16, float: false });
    expect(info.frames).toBe(4000);
    expect(wavDuration(info)).toBe(0.5);
    expect(parseWav(makeWav(32, true)).float).toBe(true);
  });

  it('refuses what is not a WAV', () => {
    expect(() => parseWav(new TextEncoder().encode('ID3 not a wav at all'))).toThrow('no-audio');
  });

  for (const [bits, float] of [
    [8, false],
    [16, false],
    [24, false],
    [32, true],
  ] as const) {
    it(`hides and finds a message in ${bits}-bit${float ? ' float' : ''} audio`, async () => {
      const wav = makeWav(bits, float);
      const carrier = wavCarrier(wav);
      expect(carrierCapacity(carrier.positions.length)).toBeGreaterThan(900);
      const hidden = await hideInCarrier(carrier, { kind: 'text', text: 'Treffpunkt 🎵' });
      // Only the lowest byte of a sample changes, by at most 1; the rest stays.
      const step = bits / 8;
      for (let i = 0; i < wav.length; i++) {
        const sampleLow = i >= 44 && i < 44 + 16000 * step && (i - 44) % step === 0;
        if (sampleLow) expect(Math.abs((hidden[i] ?? 0) - (wav[i] ?? 0))).toBeLessThanOrEqual(1);
        else expect(hidden[i]).toBe(wav[i]);
      }
      const again = wavCarrier(hidden);
      expect(peekCarrier(again)).toMatchObject({ encrypted: false, bits: 1 });
      expect(await revealFromCarrier(again)).toEqual({ kind: 'text', text: 'Treffpunkt 🎵' });
    });
  }

  it('says when the audio is too short', async () => {
    const carrier = wavCarrier(makeWav(16, false, 50, 1));
    await expect(
      hideInCarrier(carrier, { kind: 'text', text: 'x'.repeat(100) + Math.random() }),
    ).rejects.toMatchObject({ code: 'too-big' });
  });
});
