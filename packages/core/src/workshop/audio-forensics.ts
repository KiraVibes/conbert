import { fromMorse, morseTiming } from './ciphers';

/**
 * Audio tricks: where a recording was cut (jumps in the background noise,
 * clicks, changes of the mains hum), listening to any file as sound, and
 * Morse code in both directions.
 */

// ---------------------------------------------------------------- cut detector

export type CutReason = 'noise' | 'click' | 'hum';

export interface CutSuspect {
  /** Seconds from the start. */
  time: number;
  reason: CutReason;
  /** How strong (dB for noise/hum jumps, × for clicks). */
  strength: number;
}

export interface CutReport {
  duration: number;
  /** Background noise in dB, one value per `step` seconds. */
  noise: number[];
  /** Mains hum strength in dB (null without hum), one value per `step` seconds. */
  hum: (number | null)[];
  humFrequency: 50 | 60 | null;
  step: number;
  suspects: CutSuspect[];
}

const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-7));

/** Strength of one frequency in a block (Goertzel). */
function goertzel(x: Float32Array, from: number, to: number, freq: number, rate: number): number {
  const k = 2 * Math.cos((2 * Math.PI * freq) / rate);
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    const s0 = (x[i] ?? 0) + k * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - k * s1 * s2;
  return Math.sqrt(Math.max(0, power)) / Math.max(1, to - from);
}

/** Averages blocks of samples down to about 1000 per second (enough for 50/60 Hz). */
function decimate(x: Float32Array, rate: number): { y: Float32Array; rate: number } {
  const f = Math.max(1, Math.floor(rate / 1000));
  const y = new Float32Array(Math.floor(x.length / f));
  for (let i = 0; i < y.length; i++) {
    let s = 0;
    for (let k = 0; k < f; k++) s += x[i * f + k] ?? 0;
    y[i] = s / f;
  }
  return { y, rate: rate / f };
}

/**
 * Looks for the traces a cut leaves: the background noise steps up or down,
 * a click where two pieces meet, or the mains hum (50/60 Hz, picked up by
 * most recordings near power lines) suddenly changes strength.
 */
export function audioCuts(samples: Float32Array, rate: number): CutReport {
  const step = 0.5;
  const frame = Math.round(rate * 0.02);
  const per = Math.round(step / 0.02);
  // Loudness of 20 ms frames; the quietest tenth of each half second is the background.
  const frames: number[] = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let s = 0;
    for (let k = i; k < i + frame; k++) s += (samples[k] ?? 0) ** 2;
    frames.push(db(Math.sqrt(s / frame)));
  }
  // The background is the quietest tenth over 2 s – long enough to include
  // pauses in speech or music, so only a change of the room itself shows.
  const span = Math.round(2 / 0.02);
  const floor = (from: number, to: number) => {
    const part = frames.slice(Math.max(0, from), Math.min(frames.length, to)).sort((a, b) => a - b);
    return part[Math.floor(part.length * 0.1)] ?? -140;
  };
  const noise: number[] = [];
  const jumps: number[] = [];
  for (let w = 0; w * per < frames.length; w++) {
    const at = w * per;
    noise.push(floor(at - span / 2, at + span / 2));
    jumps.push(
      at >= span && at + span <= frames.length ? floor(at, at + span) - floor(at - span, at) : 0,
    );
  }

  const suspects: CutSuspect[] = [];
  for (let w = 1; w + 1 < jumps.length; w++) {
    const j = Math.abs(jumps[w] ?? 0);
    // Only the strongest point of a step counts.
    if (j > 9 && j >= Math.abs(jumps[w - 1] ?? 0) && j > Math.abs(jumps[w + 1] ?? 0))
      suspects.push({ time: w * step, reason: 'noise', strength: Math.round(j) });
  }

  // Clicks: a sudden kink in the waveform, far above its surroundings.
  const win = Math.round(rate * 0.01);
  const d2 = new Float32Array(samples.length);
  for (let i = 2; i < samples.length; i++)
    d2[i] = Math.abs((samples[i] ?? 0) - 2 * (samples[i - 1] ?? 0) + (samples[i - 2] ?? 0));
  const clicks: CutSuspect[] = [];
  for (let i = win; i + win < samples.length; i += win) {
    let peak = 0;
    let at = i;
    let sum = 0;
    for (let k = i - win; k < i + win; k++) {
      const v = d2[k] ?? 0;
      sum += v;
      if (k >= i && k < i + win && v > peak) {
        peak = v;
        at = k;
      }
    }
    const mean = (sum - peak) / (2 * win - 1);
    if (peak > 0.08 && peak > mean * 25)
      clicks.push({
        time: at / rate,
        reason: 'click',
        strength: Math.round(peak / Math.max(mean, 1e-6)),
      });
  }
  clicks.sort((a, b) => b.strength - a.strength);
  suspects.push(...clicks.slice(0, 30));

  // Mains hum.
  const { y, rate: low } = decimate(samples, rate);
  const block = Math.round(low * step * 2);
  const humLevels = (f: number) => {
    const out: number[] = [];
    for (let i = 0; i + block <= y.length; i += Math.round(low * step)) {
      const on = goertzel(y, i, i + block, f, low);
      const off =
        (goertzel(y, i, i + block, f - 7, low) + goertzel(y, i, i + block, f + 7, low)) / 2;
      out.push(on / Math.max(off, 1e-9));
    }
    return out;
  };
  const h50 = humLevels(50);
  const h60 = humLevels(60);
  const present = (r: number[]) => r.filter((v) => v > 6).length / Math.max(1, r.length);
  const humFrequency = present(h50) > 0.6 ? 50 : present(h60) > 0.6 ? 60 : null;
  const hum: (number | null)[] = [];
  if (humFrequency) {
    const levels: number[] = [];
    for (let i = 0; i + block <= y.length; i += Math.round(low * step))
      levels.push(db(goertzel(y, i, i + block, humFrequency, low)));
    hum.push(...levels);
    const change = levels.map((_, w) =>
      w >= 2 && w + 2 < levels.length
        ? ((levels[w + 1] ?? 0) + (levels[w + 2] ?? 0)) / 2 -
          ((levels[w - 2] ?? 0) + (levels[w - 1] ?? 0)) / 2
        : 0,
    );
    for (let w = 2; w + 2 < levels.length; w++) {
      const c = Math.abs(change[w] ?? 0);
      // Only the strongest point of a change counts.
      if (c > 8 && c >= Math.abs(change[w - 1] ?? 0) && c > Math.abs(change[w + 1] ?? 0))
        suspects.push({ time: (w + 0.5) * step, reason: 'hum', strength: Math.round(c) });
    }
  } else hum.push(...noise.map(() => null));

  // Close suspects belong together – keep the strongest.
  suspects.sort((a, b) => a.time - b.time);
  const merged: CutSuspect[] = [];
  for (const s of suspects) {
    const last = merged.at(-1);
    if (last && s.time - last.time < 0.75) {
      if (s.reason !== 'click' && last.reason === 'click') merged[merged.length - 1] = s;
      continue;
    }
    merged.push(s);
  }
  return { duration: samples.length / rate, noise, hum, humFrequency, step, suspects: merged };
}

// ---------------------------------------------------------------- listen to a file

/** Every byte of a file as one sound sample: a WAV file (8 bit, mono). */
export function bytesToWav(bytes: Uint8Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + bytes.length);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + bytes.length, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  text(36, 'data');
  v.setUint32(40, bytes.length, true);
  out.set(bytes, 44);
  return out;
}

// ---------------------------------------------------------------- Morse code

/** The code as sound: a sine tone, `wpm` words per minute (PARIS standard). */
export function morseAudio(code: string, rate: number, wpm = 18, freq = 650): Float32Array {
  const unit = 1.2 / wpm;
  const timing = morseTiming(code);
  const total = timing.reduce((n, t) => n + t.units, 0) + 2;
  const out = new Float32Array(Math.ceil(total * unit * rate));
  let pos = Math.round(unit * rate);
  const ramp = Math.round(rate * 0.005);
  for (const t of timing) {
    const n = Math.round(t.units * unit * rate);
    if (t.on)
      for (let i = 0; i < n; i++) {
        const env = Math.min(1, i / ramp, (n - i) / ramp);
        out[pos + i] = 0.6 * env * Math.sin((2 * Math.PI * freq * i) / rate);
      }
    pos += n;
  }
  return out;
}

/**
 * Reads Morse from a recording: the tone's loudness over time, on/off
 * lengths, then dots vs dashes and the kinds of gaps by their lengths.
 */
export function decodeMorseAudio(
  samples: Float32Array,
  rate: number,
): { code: string; text: string } {
  const hop = Math.max(1, Math.round(rate * 0.005));
  const env: number[] = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let s = 0;
    for (let k = i; k < i + hop; k++) s += Math.abs(samples[k] ?? 0);
    env.push(s / hop);
  }
  if (env.length === 0) return { code: '', text: '' };
  const sorted = [...env].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const high = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  if (high < low * 3 || high < 0.01) return { code: '', text: '' };
  const threshold = (low + high) / 2;
  // Runs of on/off, in hops – very short blips are noise.
  const runs: { on: boolean; len: number }[] = [];
  for (const v of env) {
    const on = v > threshold;
    const last = runs.at(-1);
    if (last && last.on === on) last.len++;
    else runs.push({ on, len: 1 });
  }
  const clean = runs.filter((r, i) => r.len > 2 || i === 0 || i === runs.length - 1);
  const merged: { on: boolean; len: number }[] = [];
  for (const r of clean) {
    const last = merged.at(-1);
    if (last && last.on === r.on) last.len += r.len;
    else merged.push({ ...r });
  }
  while (merged[0] && !merged[0].on) merged.shift();
  while (merged.at(-1) && !merged.at(-1)?.on) merged.pop();
  const ons = merged.filter((r) => r.on).map((r) => r.len);
  if (ons.length === 0) return { code: '', text: '' };
  // Dot length: the shorter group of tone lengths.
  const shortest = Math.min(...ons);
  const longest = Math.max(...ons);
  const unit =
    longest > shortest * 2
      ? ons.filter((l) => l < (shortest + longest) / 2).reduce((a, b) => a + b, 0) /
        Math.max(1, ons.filter((l) => l < (shortest + longest) / 2).length)
      : shortest;
  let code = '';
  for (const r of merged) {
    if (r.on) code += r.len > unit * 2 ? '-' : '.';
    else if (r.len > unit * 5) code += ' / ';
    else if (r.len > unit * 2) code += ' ';
  }
  return { code, text: fromMorse(code) };
}

/** Float samples (−1…1) as a 16-bit mono WAV file. */
export function floatWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i] ?? 0)) * 32767, true);
  return out;
}
