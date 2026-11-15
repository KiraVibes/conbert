import { describe, expect, it } from 'vitest';
import { decodeMorseAudio, morseAudio } from './audio-forensics';
import { toMorse } from './ciphers';

let seed = 3;
const noise = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;

/** A phone speaker in a room, picked up by a laptop microphone. */
function phone(
  text: string,
  wpm: number,
  freq: number,
  opts: { echo: number; snr: number; clicks: boolean; clip: number },
) {
  const rate = 48_000;
  const dry = morseAudio(toMorse(text), rate, wpm, freq);
  const out = new Float32Array(dry.length + rate);
  let tail = 0;
  let lp = 0;
  for (let i = 0; i < out.length; i++) {
    // Small speaker: clipped (overtones) and no bass.
    let v = Math.max(-opts.clip, Math.min(opts.clip, (dry[i] ?? 0) * 1.5));
    tail = tail * Math.exp(-1 / (opts.echo * rate)) + v * 0.05;
    v += tail * 0.6;
    lp += (v - lp) * 0.6;
    const n = noise() * opts.snr + 0.05 * Math.sin((2 * Math.PI * 100 * i) / rate);
    out[i] = 0.3 * lp + n + (opts.clicks && i % (rate * 1.7) < 30 ? 0.4 * noise() : 0);
  }
  return { out, rate };
}

describe('Morse from a phone through a microphone', () => {
  for (const [wpm, freq] of [
    [15, 600],
    [20, 800],
    [20, 1000],
    [25, 700],
    [12, 1800],
  ] as const)
    for (const opts of [
      { echo: 0.03, snr: 0.02, clicks: false, clip: 1 },
      { echo: 0.06, snr: 0.05, clicks: true, clip: 0.4 },
      { echo: 0.1, snr: 0.08, clicks: true, clip: 0.3 },
    ])
      it(`${wpm} wpm, ${freq} Hz, echo ${opts.echo * 1000} ms`, { timeout: 30_000 }, () => {
        const { out, rate } = phone('CQ CQ DE DL1ABC', wpm, freq, opts);
        const r = decodeMorseAudio(out, rate);
        expect(r.pitch).toBe(freq);
        // Noise at the very end may add a stray letter.
        expect(r.text.startsWith('CQ CQ DE DL1ABC')).toBe(true);
      });
});
