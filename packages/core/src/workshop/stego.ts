import { deflateSync, inflateSync } from 'fflate';
import { crc32 } from './crc';
import { looksExecutable, zipHasExecutable } from './executable';
import { bytesReader } from './reader';
import type { Raster } from './raster';
import { findZipEnd, readZipEntries } from './structure';

/**
 * Steganography (LSB): a message hides in the lowest bit of every colour
 * value. Changing 200 to 201 can't be seen, but 8 such bits make a byte.
 *
 * Layout in the colour values (R, G, B of every pixel that isn't fully
 * transparent, row by row): a header of 11 bytes at 1 bit per value, then
 * the content at 1 or 2 bits per value.
 *   header  "CnbS" · version · bits per value · flags · length (u32 BE)
 *   content [salt 16 · iv 12] · data (deflated if smaller) · CRC-32 when not encrypted
 */

export const STEGO_ERROR_CODES = [
  'nothing-hidden',
  'needs-password',
  'wrong-password',
  'damaged',
  'too-big',
  'executable',
  'no-picture',
  'no-audio',
] as const;
export type StegoErrorCode = (typeof STEGO_ERROR_CODES)[number];

export class StegoError extends Error {
  constructor(
    readonly code: StegoErrorCode,
    /** For "executable": the file that was refused. */
    readonly detail?: string,
  ) {
    super(code);
    this.name = 'StegoError';
  }
}

export type HiddenContent =
  { kind: 'text'; text: string } | { kind: 'file'; name: string; data: Uint8Array };

export interface StegoOptions {
  password?: string;
  /** Bits per colour value: 1 (invisible) or 2 (twice the room, still hardly visible). */
  bits?: 1 | 2;
}

const MAGIC = [0x43, 0x6e, 0x62, 0x53]; // "CnbS"
const VERSION = 1;
const HEADER_BYTES = 11;
const HEADER_SLOTS = HEADER_BYTES * 8;
const FLAG_ENCRYPTED = 1;
const FLAG_DEFLATED = 2;
const SALT = 16;
const IV = 12;
const TAG = 16;
const ITERATIONS = 600_000;

/** Positions of the colour values that can carry bits (skips fully transparent pixels). */
function slots(raster: Raster): Uint32Array {
  const { channels, data } = raster;
  const pixels = data.length / channels;
  const out = new Uint32Array(pixels * 3);
  let n = 0;
  for (let i = 0; i < pixels; i++) {
    const p = i * channels;
    // Programs that optimise PNGs may change the colour of invisible pixels.
    if (channels === 4 && data[p + 3] === 0) continue;
    out[n++] = p;
    out[n++] = p + 1;
    out[n++] = p + 2;
  }
  return out.subarray(0, n);
}

/** How many bytes of (packed) content fit into `slots` carrier values. */
export function carrierCapacity(slots: number, bits: 1 | 2 = 1, encrypted = false): number {
  const usable = slots - HEADER_SLOTS;
  const room = Math.floor((Math.max(0, usable) * bits) / 8);
  return Math.max(0, room - (encrypted ? SALT + IV + TAG : 4));
}

/** How many bytes of (packed) content fit into the picture. */
export function stegoCapacity(raster: Raster, bits: 1 | 2 = 1, encrypted = false): number {
  return carrierCapacity(slots(raster).length, bits, encrypted);
}

function encodeContent(content: HiddenContent): Uint8Array {
  const enc = new TextEncoder();
  if (content.kind === 'text') {
    const body = enc.encode(content.text);
    const out = new Uint8Array(1 + body.length);
    out.set(body, 1);
    return out;
  }
  const name = enc.encode(content.name).subarray(0, 255);
  const out = new Uint8Array(2 + name.length + content.data.length);
  out[0] = 1;
  out[1] = name.length;
  out.set(name, 2);
  out.set(content.data, 2 + name.length);
  return out;
}

function decodeContent(bytes: Uint8Array): HiddenContent {
  const dec = new TextDecoder();
  if (bytes[0] === 0) return { kind: 'text', text: dec.decode(bytes.subarray(1)) };
  const length = bytes[1] ?? 0;
  return {
    kind: 'file',
    name: dec.decode(bytes.subarray(2, 2 + length)),
    data: bytes.slice(2 + length),
  };
}

async function deriveKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as Uint8Array<ArrayBuffer>,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Refuses programs and scripts – also inside a ZIP. */
async function checkNotExecutable(content: HiddenContent): Promise<void> {
  if (content.kind !== 'file') return;
  if (looksExecutable(content.name, content.data.subarray(0, 4096))) {
    throw new StegoError('executable', content.name);
  }
  const reader = bytesReader(content.data);
  const end = await findZipEnd(reader).catch(() => null);
  if (!end) return;
  const entries = await readZipEntries(reader, end).catch(() => []);
  const bad = zipHasExecutable(entries.map((e) => e.name));
  if (bad) throw new StegoError('executable', bad);
}

/** Packs the content: compressed when that helps, encrypted with a password. */
export async function packContent(
  content: HiddenContent,
  password?: string,
): Promise<{ flags: number; body: Uint8Array }> {
  await checkNotExecutable(content);
  const plain = encodeContent(content);
  const packed = deflateSync(plain, { level: 9 });
  let flags = 0;
  let data = plain;
  if (packed.length < plain.length) {
    data = packed;
    flags |= FLAG_DEFLATED;
  }
  if (password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT));
    const iv = crypto.getRandomValues(new Uint8Array(IV));
    const key = await deriveKey(password, salt);
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as Uint8Array<ArrayBuffer>),
    );
    const body = new Uint8Array(SALT + IV + sealed.length);
    body.set(salt);
    body.set(iv, SALT);
    body.set(sealed, SALT + IV);
    return { flags: flags | FLAG_ENCRYPTED, body };
  }
  const body = new Uint8Array(data.length + 4);
  body.set(data);
  new DataView(body.buffer).setUint32(data.length, crc32(data));
  return { flags, body };
}

function writeBits(
  data: Uint8Array,
  positions: Uint32Array,
  from: number,
  bytes: Uint8Array,
  bits: number,
): void {
  const mask = (1 << bits) - 1;
  let slot = from;
  for (const byte of bytes) {
    for (let shift = 8 - bits; shift >= 0; shift -= bits) {
      const at = positions[slot++] ?? 0;
      data[at] = ((data[at] ?? 0) & ~mask) | ((byte >> shift) & mask);
    }
  }
}

function readBits(
  data: Uint8Array,
  positions: Uint32Array,
  from: number,
  count: number,
  bits: number,
): Uint8Array {
  const mask = (1 << bits) - 1;
  const out = new Uint8Array(count);
  let slot = from;
  for (let i = 0; i < count; i++) {
    let byte = 0;
    for (let n = 0; n < 8; n += bits)
      byte = (byte << bits) | ((data[positions[slot++] ?? 0] ?? 0) & mask);
    out[i] = byte;
  }
  return out;
}

/**
 * Anything that can carry bits: `data` with the byte positions whose lowest
 * bits may change (colour values of a picture, the low byte of audio samples).
 */
export interface Carrier {
  data: Uint8Array;
  positions: Uint32Array;
}

/** Hides the content; returns a changed copy of `carrier.data`. */
export async function hideInCarrier(
  carrier: Carrier,
  content: HiddenContent,
  options: StegoOptions = {},
): Promise<Uint8Array> {
  const bits = options.bits ?? 1;
  const { flags, body } = await packContent(content, options.password);
  const { positions } = carrier;
  const needed = HEADER_SLOTS + Math.ceil((body.length * 8) / bits);
  if (needed > positions.length) throw new StegoError('too-big');
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  header[4] = VERSION;
  header[5] = bits;
  header[6] = flags;
  new DataView(header.buffer).setUint32(7, body.length);
  const data = carrier.data.slice();
  writeBits(data, positions, 0, header, 1);
  writeBits(data, positions, HEADER_SLOTS, body, bits);
  return data;
}

/** Hides the content in a copy of the picture. */
export async function hideInRaster(
  raster: Raster,
  content: HiddenContent,
  options: StegoOptions = {},
): Promise<Raster> {
  const data = await hideInCarrier(
    { data: raster.data, positions: slots(raster) },
    content,
    options,
  );
  return { ...raster, data };
}

export interface HiddenInfo {
  encrypted: boolean;
  bits: 1 | 2;
  /** Bytes of hidden (packed) content. */
  length: number;
}

/** Is there a Conbert message in the carrier? Reads only the header. */
export function peekCarrier({ data, positions }: Carrier): HiddenInfo | null {
  if (positions.length < HEADER_SLOTS) return null;
  const header = readBits(data, positions, 0, HEADER_BYTES, 1);
  if (!MAGIC.every((b, i) => header[i] === b) || header[4] !== VERSION) return null;
  const bits = header[5];
  if (bits !== 1 && bits !== 2) return null;
  const length = new DataView(header.buffer).getUint32(7);
  if (HEADER_SLOTS + Math.ceil((length * 8) / bits) > positions.length) return null;
  return { encrypted: ((header[6] ?? 0) & FLAG_ENCRYPTED) !== 0, bits, length };
}

/** Is there a Conbert message in the picture? Reads only the header. */
export const peekHidden = (raster: Raster): HiddenInfo | null =>
  peekCarrier({ data: raster.data, positions: slots(raster) });

/** Reads the hidden content back. */
export async function revealFromCarrier(
  carrier: Carrier,
  password?: string,
): Promise<HiddenContent> {
  const info = peekCarrier(carrier);
  if (!info) throw new StegoError('nothing-hidden');
  const { data, positions } = carrier;
  const flags = readBits(data, positions, 0, HEADER_BYTES, 1)[6] ?? 0;
  const body = readBits(data, positions, HEADER_SLOTS, info.length, info.bits);
  return unpackContent(flags, body, password);
}

/** Unpacks what `packContent` made (checks the CRC or the password). */
export async function unpackContent(
  flags: number,
  body: Uint8Array,
  password?: string,
): Promise<HiddenContent> {
  let data: Uint8Array;
  if (flags & FLAG_ENCRYPTED) {
    if (!password) throw new StegoError('needs-password');
    if (body.length < SALT + IV + TAG) throw new StegoError('damaged');
    const key = await deriveKey(password, body.subarray(0, SALT));
    try {
      data = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: body.subarray(SALT, SALT + IV) as Uint8Array<ArrayBuffer> },
          key,
          body.subarray(SALT + IV) as Uint8Array<ArrayBuffer>,
        ),
      );
    } catch {
      throw new StegoError('wrong-password');
    }
  } else {
    if (body.length < 4) throw new StegoError('damaged');
    data = body.subarray(0, body.length - 4);
    const stored = new DataView(body.buffer, body.byteOffset).getUint32(body.length - 4);
    if (crc32(data) !== stored) throw new StegoError('damaged');
  }
  if (flags & FLAG_DEFLATED) {
    try {
      data = inflateSync(data);
    } catch {
      throw new StegoError('damaged');
    }
  }
  return decodeContent(data);
}

/** Is this packed content locked with a password? */
export const isEncryptedFlags = (flags: number) => (flags & FLAG_ENCRYPTED) !== 0;

/** Reads the hidden content back from a picture. */
export const revealFromRaster = (raster: Raster, password?: string): Promise<HiddenContent> =>
  revealFromCarrier({ data: raster.data, positions: slots(raster) }, password);

// --- Looking for traces ----------------------------------------------------------

/**
 * The lowest bits as a picture (RGBA): each colour value's last bit becomes
 * 0 or 255. Normal photos show shapes or soft noise; hidden data shows up
 * as a band of even, grainy noise.
 */
export function lsbPlane(raster: Raster): Uint8Array {
  const { width, height, channels, data } = raster;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const transparent = channels === 4 && data[s + 3] === 0;
    for (let c = 0; c < 3; c++) {
      out[i * 4 + c] = transparent ? 128 : ((data[s + c] ?? 0) & 1) * 255;
    }
    out[i * 4 + 3] = 255;
  }
  return out;
}

function logGamma(x: number): number {
  const c = [
    76.18009172947146, -86.50532032941678, 24.01409824083091, -1.231739572450155,
    0.00120865097386618, -0.000005395239384953,
  ];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const v of c) ser += v / ++y;
  return -tmp + Math.log((Math.sqrt(2 * Math.PI) * ser) / x);
}

/** Regularised lower incomplete gamma function P(a, x). */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const gln = logGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 500; n++) {
      del *= x / ++ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - gln));
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.max(0, 1 - Math.exp(-x + a * Math.log(x) - gln) * h);
}

/**
 * The chi-square attack (Westfeld & Pfitzmann): hiding random bits makes the
 * values 2k and 2k+1 equally common. For each strip of the picture (5 % each,
 * top to bottom) this gives the likelihood (0–1) that something is hidden
 * there. A message written from the start shows as high values that drop
 * where it ends.
 */
export function chiSquareProfile(raster: Raster, steps = 20): number[] {
  const positions = slots(raster);
  const out: number[] = [];
  for (let step = 0; step < steps; step++) {
    const from = Math.floor((positions.length * step) / steps);
    const until = Math.floor((positions.length * (step + 1)) / steps);
    const histogram = new Float64Array(256);
    for (let i = from; i < until; i++) {
      const value = raster.data[positions[i] ?? 0] ?? 0;
      histogram[value] = (histogram[value] ?? 0) + 1;
    }
    let chi = 0;
    let categories = 0;
    for (let k = 0; k < 128; k++) {
      const even = histogram[2 * k] ?? 0;
      const odd = histogram[2 * k + 1] ?? 0;
      const expected = (even + odd) / 2;
      if (expected < 5) continue;
      chi += (even - expected) ** 2 / expected;
      categories++;
    }
    out.push(categories < 2 ? 0 : 1 - gammaP((categories - 1) / 2, chi / 2));
  }
  return out;
}

export type ChiVerdict =
  | { kind: 'calm' }
  /** High from the top, then calm: probably hidden data in the first `percent` %. */
  | { kind: 'suspicious'; percent: number }
  /** High almost everywhere: a very noisy picture (or one completely full of data). */
  | { kind: 'unclear' };

/** Reads the strip values like an expert would: a high run from the top that then drops. */
export function chiSquareVerdict(profile: readonly number[]): ChiVerdict {
  // Smooth areas (sky) have few colour values and score lower even when
  // full of data, so judge the whole run of high strips from the top.
  // Single strips scatter, so each is looked at together with its neighbours.
  const smooth = profile.map((_, i) => {
    const near = profile.slice(Math.max(0, i - 1), i + 2);
    return near.reduce((sum, v) => sum + v, 0) / near.length;
  });
  let run = 0;
  while (run < smooth.length && (smooth[run] ?? 0) > 0.5) run++;
  const mean = profile.slice(0, run).reduce((sum, v) => sum + v, 0) / Math.max(1, run);
  if (run === 0 || mean <= 0.75) return { kind: 'calm' };
  const rest = profile.slice(run + 1);
  const high = rest.filter((v) => v > 0.5).length;
  if (rest.length === 0 || high > rest.length / 3) return { kind: 'unclear' };
  return { kind: 'suspicious', percent: Math.round((run / profile.length) * 100) };
}
