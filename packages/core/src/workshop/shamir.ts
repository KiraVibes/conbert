import { crc32 } from './crc';

/**
 * Schatzkarte: Shamir's secret sharing. A secret is split into N parts so
 * that any K of them bring it back – with fewer than K, nothing at all can
 * be learnt about it. Each byte is the constant of a random polynomial of
 * degree K−1 over GF(256); every part is one point of all these polynomials.
 */

// --- GF(256) with the AES polynomial x^8 + x^4 + x^3 + x + 1 ----------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // Multiply by the generator 3: x·2 xor x.
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] ?? 0;
}

const mul = (a: number, b: number) =>
  a === 0 || b === 0 ? 0 : (EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0);
const div = (a: number, b: number) =>
  a === 0 ? 0 : (EXP[(LOG[a] ?? 0) + 255 - (LOG[b] ?? 0)] ?? 0);

/** The value of the polynomial (coefficients from the constant upwards) at x. */
function evaluate(coefficients: Uint8Array, x: number): number {
  let y = 0;
  for (let i = coefficients.length - 1; i >= 0; i--) y = mul(y, x) ^ (coefficients[i] ?? 0);
  return y;
}

export const MAX_SHARES = 16;
/** Big enough for passwords, notes, keys and small files. */
export const MAX_SECRET_BYTES = 64 * 1024;

export class ShamirError extends Error {
  constructor(
    readonly code:
      'too-few' | 'mixed' | 'damaged' | 'duplicate' | 'not-a-share' | 'too-big' | 'bad-count',
  ) {
    super(code);
    this.name = 'ShamirError';
  }
}

export const SHAMIR_ERROR_CODES = [
  'too-few',
  'mixed',
  'damaged',
  'duplicate',
  'not-a-share',
  'too-big',
  'bad-count',
] as const;

/** What is kept: a text, or a file with its name. */
export type Secret =
  { kind: 'text'; text: string } | { kind: 'file'; name: string; data: Uint8Array };

function encodeSecret(secret: Secret): Uint8Array {
  const enc = new TextEncoder();
  if (secret.kind === 'text') {
    const body = enc.encode(secret.text);
    const out = new Uint8Array(1 + body.length);
    out[0] = 0;
    out.set(body, 1);
    return out;
  }
  const name = enc.encode(secret.name).subarray(0, 255);
  const out = new Uint8Array(2 + name.length + secret.data.length);
  out[0] = 1;
  out[1] = name.length;
  out.set(name, 2);
  out.set(secret.data, 2 + name.length);
  return out;
}

function decodeSecret(bytes: Uint8Array): Secret {
  const dec = new TextDecoder();
  if (bytes[0] === 0) return { kind: 'text', text: dec.decode(bytes.subarray(1)) };
  const length = bytes[1] ?? 0;
  return {
    kind: 'file',
    name: dec.decode(bytes.subarray(2, 2 + length)),
    data: bytes.slice(2 + length),
  };
}

const toBase64Url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (text: string) => {
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const hex = (n: number, digits: number) => n.toString(16).padStart(digits, '0');

/** One part as text: "conbert-teil:1:<set>:<needed>:<number>:<data>:<check>". */
export interface Share {
  set: string;
  needed: number;
  x: number;
  data: Uint8Array;
}

export function formatShare(share: Share): string {
  const body = `conbert-teil:1:${share.set}:${share.needed}:${share.x}:${toBase64Url(share.data)}`;
  return `${body}:${hex(crc32(new TextEncoder().encode(body)), 8)}`;
}

/** A part from text – with a checksum, so typos are found. */
export function parseShare(text: string): Share {
  const m = /conbert-teil:1:([0-9a-f]{8}):(\d{1,2}):(\d{1,3}):([A-Za-z0-9_-]+):([0-9a-f]{8})/.exec(
    text.replace(/\s+/g, ''),
  );
  if (!m) throw new ShamirError('not-a-share');
  const body = `conbert-teil:1:${m[1]}:${m[2]}:${m[3]}:${m[4]}`;
  if (hex(crc32(new TextEncoder().encode(body)), 8) !== m[5]) throw new ShamirError('damaged');
  return {
    set: m[1] ?? '',
    needed: Number(m[2]),
    x: Number(m[3]),
    data: fromBase64Url(m[4] ?? ''),
  };
}

/**
 * Splits a secret into `total` parts, `needed` of which bring it back.
 * `random` fills an array with random bytes (crypto.getRandomValues).
 */
export function splitSecret(
  secret: Secret,
  total: number,
  needed: number,
  random: (bytes: Uint8Array) => Uint8Array,
): string[] {
  if (!(needed >= 2 && needed <= total && total <= MAX_SHARES)) {
    throw new ShamirError('bad-count');
  }
  const plain = encodeSecret(secret);
  if (plain.length > MAX_SECRET_BYTES) throw new ShamirError('too-big');
  // A checksum inside the secret: a wrong mix of parts is noticed when joining.
  const withCheck = new Uint8Array(plain.length + 4);
  withCheck.set(plain);
  new DataView(withCheck.buffer).setUint32(plain.length, crc32(plain));
  const set = hex(new DataView(random(new Uint8Array(4)).buffer).getUint32(0), 8);
  const parts = Array.from({ length: total }, () => new Uint8Array(withCheck.length));
  const coefficients = new Uint8Array(needed);
  for (let i = 0; i < withCheck.length; i++) {
    random(coefficients);
    coefficients[0] = withCheck[i] ?? 0;
    for (const [p, part] of parts.entries()) part[i] = evaluate(coefficients, p + 1);
  }
  return parts.map((data, p) => formatShare({ set, needed, x: p + 1, data }));
}

/** Puts the secret back together from enough parts (Lagrange at x = 0). */
export function combineShares(texts: string[]): Secret {
  const shares = texts.map(parseShare);
  const first = shares[0];
  if (!first) throw new ShamirError('too-few');
  if (shares.some((s) => s.set !== first.set || s.data.length !== first.data.length)) {
    throw new ShamirError('mixed');
  }
  const xs = shares.map((s) => s.x);
  if (new Set(xs).size !== xs.length) throw new ShamirError('duplicate');
  if (shares.length < first.needed) throw new ShamirError('too-few');
  const used = shares.slice(0, first.needed);
  const out = new Uint8Array(first.data.length);
  for (let i = 0; i < out.length; i++) {
    let value = 0;
    for (const [j, sj] of used.entries()) {
      let basis = 1;
      for (const [m, sm] of used.entries()) {
        if (m !== j) basis = mul(basis, div(sm.x, sm.x ^ sj.x));
      }
      value ^= mul(sj.data[i] ?? 0, basis);
    }
    out[i] = value;
  }
  const plain = out.subarray(0, out.length - 4);
  const stored = new DataView(out.buffer).getUint32(out.length - 4);
  if (crc32(plain) !== stored) throw new ShamirError('damaged');
  return decodeSecret(plain);
}

/** All parts in a pasted text – one per line, or wrapped by a mail program. */
export function findShares(text: string): string[] {
  return text
    .replace(/\s+/g, '')
    .split(/(?=conbert-teil:)/)
    .filter((part) => part.startsWith('conbert-teil:'));
}
