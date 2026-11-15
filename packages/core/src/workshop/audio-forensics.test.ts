import { describe, expect, it } from 'vitest';
import { audioCuts, bytesToWav, decodeMorseAudio, morseAudio } from './audio-forensics';
import { fromMorse, morseTiming, toMorse } from './ciphers';
import { parseWav } from './wav';

const RATE = 8000;
let seed = 5;
const noise = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;

describe('cut detector', () => {
  it('finds where two recordings with different background noise meet', () => {
    // 6 s quiet room + hum, then 6 s of a louder room without the same hum.
    const x = new Float32Array(RATE * 12);
    for (let i = 0; i < x.length; i++) {
      const first = i < RATE * 6;
      x[i] =
        (first ? 0.002 : 0.03) * noise() +
        (first
          ? 0.02 * Math.sin((2 * Math.PI * 50 * i) / RATE)
          : 0.002 * Math.sin((2 * Math.PI * 50 * i) / RATE));
    }
    const r = audioCuts(x, RATE);
    expect(r.humFrequency).toBe(50);
    const near = r.suspects.filter((s) => Math.abs(s.time - 6) < 1);
    expect(near.length).toBeGreaterThan(0);
    expect(r.suspects.filter((s) => Math.abs(s.time - 6) >= 1.5)).toEqual([]);
  });

  it('finds a click at a hard cut', () => {
    const x = new Float32Array(RATE * 4);
    for (let i = 0; i < x.length; i++)
      x[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / RATE + (i >= RATE * 2 ? 2 : 0));
    const r = audioCuts(x, RATE);
    expect(r.suspects.some((s) => s.reason === 'click' && Math.abs(s.time - 2) < 0.05)).toBe(true);
  });

  it('is not fooled by speech that starts and stops', () => {
    const x = new Float32Array(RATE * 10);
    for (let i = 0; i < x.length; i++) {
      const talking = Math.floor(i / RATE) % 2 === 1;
      x[i] = 0.005 * noise() + (talking ? 0.3 * Math.sin((2 * Math.PI * 300 * i) / RATE) : 0);
    }
    expect(audioCuts(x, RATE).suspects.filter((s) => s.reason === 'noise')).toEqual([]);
  });

  it('stays quiet on an even recording', () => {
    const x = new Float32Array(RATE * 8).map(() => 0.01 * noise());
    expect(audioCuts(x, RATE).suspects).toEqual([]);
  });
});

describe('listen to a file', () => {
  it('makes a playable 8-bit WAV of the bytes', () => {
    const wav = bytesToWav(new Uint8Array([1, 2, 3, 250]), 8000);
    const info = parseWav(wav);
    expect(info.sampleRate).toBe(8000);
    expect(info.bitsPerSample).toBe(8);
    expect([...wav.subarray(44)]).toEqual([1, 2, 3, 250]);
  });
});

describe('Morse', () => {
  it('writes and reads text', () => {
    expect(toMorse('SOS hi')).toBe('... --- ... / .... ..');
    expect(fromMorse('... --- ... / .... ..')).toBe('SOS HI');
    expect(fromMorse('·· ___')).toBe('IO');
    expect(fromMorse('...---.-.-.-.-')).toBe('?');
  });

  it('reads a microphone-like recording: echo, noise, hum, changing volume', () => {
    const rate = 48_000;
    const clean = morseAudio(toMorse('SOS 73 DL'), rate, 16, 800);
    const rec = new Float32Array(clean.length + rate);
    // Room echo: a decaying copy of the sound (about 60 ms).
    let tail = 0;
    for (let i = 0; i < rec.length; i++) {
      const dry = clean[i] ?? 0;
      tail = tail * Math.exp(-1 / (0.06 * rate)) + dry * 0.02;
      const gain = 0.4 + 0.3 * Math.sin(i / rate); // automatic volume control
      rec[i] =
        gain * (dry + 0.5 * Math.sin((2 * Math.PI * 800 * i) / rate) * Math.abs(tail)) +
        0.08 * noise() +
        0.15 * Math.sin((2 * Math.PI * 50 * i) / rate);
    }
    expect(decodeMorseAudio(rec, rate).text).toBe('SOS 73 DL');
  });

  it('reads strong room echo: tones get longer, gaps shorter', () => {
    const rate = 16_000;
    const wpm = 20;
    const code = toMorse('PARIS HALLO 2026');
    // The on/off pattern as an envelope with a slow fade (about 70 ms) after each tone.
    const unit = (1.2 / wpm) * rate;
    const timing = morseTiming(code);
    const total = Math.ceil(timing.reduce((n, t) => n + t.units, 0) * unit + rate);
    const env = new Float32Array(total);
    let pos = Math.round(rate * 0.3);
    for (const t of timing) {
      const n = Math.round(t.units * unit);
      if (t.on) env.fill(1, pos, pos + n);
      pos += n;
    }
    const rec = new Float32Array(total);
    let level = 0;
    for (let i = 0; i < total; i++) {
      const target = env[i] ?? 0;
      // Fast rise (10 ms), slow fade (70 ms).
      level += (target - level) / ((target > level ? 0.01 : 0.07) * rate);
      rec[i] = 0.5 * level * Math.sin((2 * Math.PI * 700 * i) / rate) + 0.03 * noise();
    }
    expect(decodeMorseAudio(rec, rate).text).toBe('PARIS HALLO 2026');
  });

  it('does not read speech as Morse', () => {
    // Syllables like "Gu-ten Mor-gen": a gliding voice pitch with overtones.
    const rate = 16_000;
    const x = new Float32Array(rate * 3);
    const syllables = [
      [0.2, 0.45, 140, 170],
      [0.55, 0.8, 170, 130],
      [1.2, 1.5, 150, 190],
      [1.6, 1.9, 190, 120],
    ];
    let phase = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / rate;
      const s = syllables.find(([a, b]) => t >= (a ?? 0) && t < (b ?? 0));
      if (!s) {
        x[i] = 0.01 * noise();
        continue;
      }
      const [a = 0, b = 1, f1 = 150, f2 = 150] = s;
      const f0 = f1 + ((f2 - f1) * (t - a)) / (b - a);
      phase += (2 * Math.PI * f0) / rate;
      let v = 0;
      // Harmonics, the 3rd to 6th loudest (vowel formants around 500–900 Hz).
      for (let h = 1; h <= 12; h++) v += Math.sin(h * phase) * (h >= 3 && h <= 6 ? 0.3 : 0.08);
      x[i] = 0.3 * v + 0.01 * noise();
    }
    const r = decodeMorseAudio(x, rate);
    expect(r.text).toBe('');
    expect(r.notMorse).toBe(true);
  });

  it('reads its own sound back, also with noise', () => {
    const code = toMorse('Hallo Welt 42');
    const audio = morseAudio(code, RATE, 20);
    for (let i = 0; i < audio.length; i++) audio[i] = (audio[i] ?? 0) + 0.05 * noise();
    expect(decodeMorseAudio(audio, RATE).text).toBe('HALLO WELT 42');
  });
});
