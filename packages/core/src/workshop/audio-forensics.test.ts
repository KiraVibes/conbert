import { describe, expect, it } from 'vitest';
import { audioCuts, bytesToWav, decodeMorseAudio, morseAudio } from './audio-forensics';
import { fromMorse, toMorse } from './ciphers';
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

  it('reads its own sound back, also with noise', () => {
    const code = toMorse('Hallo Welt 42');
    const audio = morseAudio(code, RATE, 20);
    for (let i = 0; i < audio.length; i++) audio[i] = (audio[i] ?? 0) + 0.05 * noise();
    expect(decodeMorseAudio(audio, RATE).text).toBe('HALLO WELT 42');
  });
});
