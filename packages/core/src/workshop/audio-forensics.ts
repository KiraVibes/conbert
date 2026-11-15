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
 * Reads Morse from a recording (also through a microphone): first the beep's
 * pitch is found (the strongest tone between 300 and 1500 Hz), then only
 * that pitch is followed – room noise, voices and hum don't count. On and
 * off are told apart in decibels with a little hysteresis, so echo tails
 * don't swallow the gaps; dots and dashes are told apart by their lengths.
 */
/** Beep pitches the reader looks for (Morse apps use roughly 400–2000 Hz). */
const MIN_PITCH = 300;
const MAX_PITCH = 2500;

export interface MorseHeard {
  code: string;
  text: string;
  /** The beep's pitch in Hz (0 when no beep was found). */
  pitch: number;
  /** Length of one dot in milliseconds. */
  unitMs: number;
  /** How many tones were heard. */
  tones: number;
  /** Sound was there, but no steady beep (e.g. speech or music). */
  notMorse?: boolean;
}

export function decodeMorseAudio(samples: Float32Array, rate: number): MorseHeard {
  const none: MorseHeard = { code: '', text: '', pitch: 0, unitMs: 0, tones: 0 };
  // About 8000 samples per second are plenty for a beep up to 2500 Hz.
  const factor = Math.max(1, Math.floor(rate / 8000));
  const sr = rate / factor;
  const x = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += samples[i * factor + k] ?? 0;
    x[i] = s / factor;
  }
  const frame = Math.round(sr * 0.02);
  if (x.length < frame * 5) return none;
  // The beep's pitch: the loudest frequency summed over all frames.
  let best = 0;
  let pitch = 0;
  for (let f = MIN_PITCH; f <= MAX_PITCH; f += 10) {
    let sum = 0;
    for (let i = 0; i + frame <= x.length; i += frame) sum += goertzel(x, i, i + frame, f, sr);
    if (sum > best) {
      best = sum;
      pitch = f;
    }
  }
  // Loudness of that pitch every 5 ms (window 15 ms), in dB.
  const hop = Math.max(1, Math.round(sr * 0.005));
  const win = hop * 3;
  const env: number[] = [];
  for (let i = 0; i + win <= x.length; i += hop) env.push(db(goertzel(x, i, i + win, pitch, sr)));
  const sorted = [...env].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const high = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  if (high - low < 8) return none;
  // Edges, not a fixed line: "off" once the level falls clearly below the
  // current tone's peak, "on" once it rises clearly above the dip before.
  // With echo the level never reaches the floor in short gaps – a fixed
  // threshold would glue a whole letter into one tone.
  const step = Math.min(6, (high - low) * 0.25);
  const floorLine = low + (high - low) * 0.3;
  const runs: { on: boolean; len: number; at: number }[] = [];
  let on = false;
  let peak = -Infinity;
  let dip = Infinity;
  for (const [at, v] of env.entries()) {
    if (on) {
      peak = Math.max(peak, v);
      if (v < peak - step || v < floorLine) {
        on = false;
        dip = v;
      }
    } else {
      dip = Math.min(dip, v);
      if (v > dip + step && v > floorLine) {
        on = true;
        peak = v;
      }
    }
    const last = runs.at(-1);
    if (last && last.on === on) last.len++;
    else runs.push({ on, len: 1, at });
  }
  // Blips under 15 ms are noise: they join their neighbours.
  const merged: { on: boolean; len: number; at: number }[] = [];
  for (const r of runs) {
    const last = merged.at(-1);
    if (last && (last.on === r.on || r.len < 3)) last.len += r.len;
    else merged.push({ ...r });
  }
  while (merged[0] && !merged[0].on) merged.shift();
  while (merged.at(-1) && !merged.at(-1)?.on) merged.pop();
  const ons = merged.filter((r) => r.on).map((r) => r.len);
  if (ons.length === 0) return none;
  // A Morse beep is one pure tone, always at the same pitch. Speech, music
  // and noise have overtones and a pitch that keeps moving – not Morse.
  const pure = (r: { at: number; len: number }) => {
    const from = r.at * hop;
    const to = Math.min(x.length, (r.at + r.len) * hop + win);
    const half = Math.floor((from + to) / 2);
    const strongest = (a: number, b: number) => {
      let f0 = 0;
      let v0 = 0;
      for (
        let f = Math.max(MIN_PITCH, pitch - 200);
        f <= Math.min(MAX_PITCH, pitch + 200);
        f += 10
      ) {
        const v = goertzel(x, a, b, f, sr);
        if (v > v0) {
          v0 = v;
          f0 = f;
        }
      }
      return { f: f0, v: v0 };
    };
    const whole = strongest(from, to);
    const side =
      (goertzel(x, from, to, whole.f - 150, sr) + goertzel(x, from, to, whole.f + 150, sr)) / 2;
    return (
      Math.abs(whole.f - pitch) <= 40 &&
      whole.v > side * 3 &&
      Math.abs(strongest(from, half).f - strongest(half, to).f) <= 40
    );
  };
  let pureTime = 0;
  let toneTime = 0;
  const checked = merged.map((r) => {
    if (!r.on) return r;
    const ok = pure(r);
    toneTime += r.len;
    if (ok) pureTime += r.len;
    // A click or a noise burst is no tone – it counts as part of the gap.
    return ok ? r : { ...r, on: false };
  });
  if (pureTime < toneTime * 0.6) return { ...none, tones: ons.length, pitch, notMorse: true };
  const clean: typeof merged = [];
  for (const r of checked) {
    const last = clean.at(-1);
    if (last && last.on === r.on) last.len += r.len;
    else clean.push({ ...r });
  }
  while (clean[0] && !clean[0].on) clean.shift();
  while (clean.at(-1) && !clean.at(-1)?.on) clean.pop();
  const tones = clean.filter((r) => r.on).map((r) => r.len);
  const gaps = clean.filter((r) => !r.on).map((r) => r.len);
  if (tones.length === 0) return none;
  // Echo (and the threshold) make every tone longer and every gap shorter by
  // the same amount. The *difference* dash − dot stays exactly 2 units, and
  // tone + gap stays right – both don't care about the echo.
  const groups = splitLengths(tones);
  let unit: number;
  let bias: number;
  if (groups.split) {
    unit = (groups.high - groups.low) / 2;
    bias = groups.low - unit;
  } else {
    // Only one kind of tone: dot + shortest kind of gap = 2 units.
    const shortGap = gaps.length ? splitLengths(gaps).low : groups.low;
    unit = (groups.low + shortGap) / 2;
    bias = groups.low - unit;
    // Long tones with short gaps between them: dashes.
    if (gaps.length && groups.low - bias > unit * 2) {
      unit = (groups.low + shortGap) / 4;
      bias = groups.low - 3 * unit;
    }
  }
  unit = Math.max(unit, 1);
  let code = '';
  for (const r of clean) {
    const len = r.on ? r.len - bias : r.len + bias;
    if (r.on) code += len > unit * 2 ? '-' : '.';
    else if (len > unit * 5) code += ' / ';
    else if (len > unit * 2) code += ' ';
  }
  return {
    code,
    text: fromMorse(code),
    pitch,
    unitMs: (unit * hop * 1000) / sr,
    tones: tones.length,
  };
}

/**
 * Splits lengths into a short and a long group (2-means). They count as two
 * groups when the groups lie clearly apart compared with their spread.
 */
function splitLengths(values: number[]): { low: number; high: number; split: boolean } {
  if (values.length === 0) return { low: 1, high: 1, split: false };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  let a: number[] = values;
  let b: number[] = [];
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    a = values.filter((v) => v <= mid);
    b = values.filter((v) => v > mid);
    const nlo = a.length ? a.reduce((s, v) => s + v, 0) / a.length : lo;
    const nhi = b.length ? b.reduce((s, v) => s + v, 0) / b.length : hi;
    if (nlo === lo && nhi === hi) break;
    lo = nlo;
    hi = nhi;
  }
  const spread = (g: number[], m: number) =>
    g.length ? Math.sqrt(g.reduce((s, v) => s + (v - m) ** 2, 0) / g.length) : 0;
  const noise = Math.max(spread(a, lo), spread(b, hi), 1);
  return { low: lo, high: hi, split: b.length > 0 && hi - lo > 3 * noise && hi > lo * 1.4 };
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
