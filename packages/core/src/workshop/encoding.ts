/**
 * Turning bytes into text and back: Base64, hex, URL encoding and data URIs.
 * Decoding is forgiving (spaces, line breaks, missing "=" are fine) and
 * returns null for input that isn't valid.
 */

export const TEXT_CODECS = ['base64', 'base64url', 'hex', 'url'] as const;
export type TextCodec = (typeof TEXT_CODECS)[number];

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const b64 = btoa(binary);
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

export function base64ToBytes(text: string): Uint8Array | null {
  let s = text.replace(/\s+/g, '');
  // Accept the URL-safe alphabet and missing padding as well.
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  s = s.replace(/=+$/, '');
  if (s.length % 4 === 1) return null;
  s += '='.repeat((4 - (s.length % 4)) % 4);
  try {
    const binary = atob(s);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function bytesToHex(bytes: Uint8Array, spaced = false): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    if (spaced && i > 0) out += i % 16 === 0 ? '\n' : ' ';
    out += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}

/** "48 65 6c", "0x48,0x65", "48:65" and "48656C" all work. */
export function hexToBytes(text: string): Uint8Array | null {
  const s = text.replace(/0x/gi, '').replace(/[\s,:;-]+/g, '');
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function urlDecode(text: string): string | null {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}

/** Text → encoded text (UTF-8 for the byte-based codecs). */
export function encodeText(text: string, codec: TextCodec): string {
  if (codec === 'url') return encodeURIComponent(text);
  const bytes = new TextEncoder().encode(text);
  if (codec === 'hex') return bytesToHex(bytes, true);
  return bytesToBase64(bytes, codec === 'base64url');
}

export type DecodedText =
  | { ok: true; text: string }
  /** Valid, but the bytes are no UTF-8 text (a picture, a program …). */
  | { ok: false; reason: 'binary'; bytes: Uint8Array }
  | { ok: false; reason: 'invalid' };

export function decodeText(text: string, codec: TextCodec): DecodedText {
  if (codec === 'url') {
    const decoded = urlDecode(text);
    return decoded === null ? { ok: false, reason: 'invalid' } : { ok: true, text: decoded };
  }
  const bytes = codec === 'hex' ? hexToBytes(text) : base64ToBytes(text);
  if (!bytes) return { ok: false, reason: 'invalid' };
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: 'binary', bytes };
  }
}

// --- Data URIs ---

export function dataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

/** "data:image/png;base64,…" (or with %-encoded text) → type and bytes. */
export function parseDataUri(text: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^\s*data:([^,]*?),(.*)$/s.exec(text);
  if (!m) return null;
  const meta = (m[1] ?? '').split(';');
  const mime = meta[0]?.trim() || 'text/plain';
  const body = m[2] ?? '';
  if (meta.some((p) => p.trim().toLowerCase() === 'base64')) {
    const bytes = base64ToBytes(body);
    return bytes ? { mime, bytes } : null;
  }
  const decoded = urlDecode(body);
  return decoded === null ? null : { mime, bytes: new TextEncoder().encode(decoded) };
}

/** Pasted text → bytes: a data URI, hex or Base64 (in that order). */
export function decodeAny(
  text: string,
): { bytes: Uint8Array; mime: string | null; from: 'datauri' | 'hex' | 'base64' } | null {
  const uri = parseDataUri(text);
  if (uri) return { bytes: uri.bytes, mime: uri.mime, from: 'datauri' };
  const trimmed = text.trim();
  // Pure hex digits are also valid Base64 – hex wins when it looks like hex.
  if (/^(0x)?[0-9a-fA-F]{2}([\s,:]*(0x)?[0-9a-fA-F]{2})*$/.test(trimmed)) {
    const hex = hexToBytes(trimmed);
    if (hex) return { bytes: hex, mime: null, from: 'hex' };
  }
  const b64 = base64ToBytes(trimmed);
  return b64 && b64.length > 0 ? { bytes: b64, mime: null, from: 'base64' } : null;
}
