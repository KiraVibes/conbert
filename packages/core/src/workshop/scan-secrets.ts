import { SEALED_PREFIX } from './meta-secret';
import { decodeRaster } from './raster';
import type { ByteReader } from './reader';
import { chiSquareProfile, chiSquareVerdict, peekHidden, peekCarrier } from './stego';
import { parseWav, wavCarrier } from './wav';
import { peekHiddenText } from './zero-width';

/**
 * Traces of the workshop's own hiding tricks (and of LSB steganography in
 * general) for the detective scan. Each finding names the trick that can
 * open it.
 */

export interface SecretFinding {
  kind: 'stego' | 'lsb' | 'sealed';
  offset: number;
  length: number;
  key: string;
  values?: Record<string, string | number>;
  /** Workshop trick that opens it. */
  trick: string;
}

/** Pictures and sound are decoded whole – only up to this size. */
const MAX_DECODE = 100 * 1024 * 1024;
const WINDOW = 1024 * 1024;

/** A Conbert message (or suspicious lowest bits) in a PNG or BMP. */
export async function pictureSecrets(reader: ByteReader): Promise<SecretFinding[]> {
  if (reader.size > MAX_DECODE) return [];
  const raster = decodeRaster(await reader.read(0, reader.size));
  if (!raster) return [];
  const hidden = peekHidden(raster);
  if (hidden) {
    return [
      {
        kind: 'stego',
        offset: 0,
        length: reader.size,
        key: hidden.encrypted ? 'stegoPictureLocked' : 'stegoPicture',
        values: { bytes: hidden.length },
        trick: 'stego',
      },
    ];
  }
  const verdict = chiSquareVerdict(chiSquareProfile(raster));
  if (verdict.kind !== 'suspicious') return [];
  return [
    {
      kind: 'lsb',
      offset: 0,
      length: reader.size,
      key: 'lsbSuspicious',
      values: { percent: verdict.percent },
      trick: 'stego',
    },
  ];
}

/** A Conbert message in the samples of a WAV file. */
export async function audioSecrets(reader: ByteReader): Promise<SecretFinding[]> {
  if (reader.size > MAX_DECODE) return [];
  const bytes = await reader.read(0, reader.size);
  let info;
  try {
    info = parseWav(bytes);
  } catch {
    return [];
  }
  const hidden = peekCarrier(wavCarrier(bytes, info));
  if (!hidden) return [];
  return [
    {
      kind: 'stego',
      offset: info.dataOffset,
      length: info.dataLength,
      key: hidden.encrypted ? 'stegoAudioLocked' : 'stegoAudio',
      values: { bytes: hidden.length },
      trick: 'audiostego',
    },
  ];
}

/** A Conbert message written with zero-width characters. */
export function textSecrets(text: string, offset = 0): SecretFinding[] {
  const hidden = peekHiddenText(text);
  if (!hidden) return [];
  return [
    {
      kind: 'stego',
      offset,
      length: hidden.characters * 3,
      key: hidden.encrypted ? 'zeroWidthMessageLocked' : 'zeroWidthMessage',
      values: { count: hidden.characters },
      trick: 'invisible',
    },
  ];
}

const enc = new TextEncoder();
const utf16 = (text: string, littleEndian: boolean) =>
  Uint8Array.from(
    [...text].flatMap((c) => (littleEndian ? [c.charCodeAt(0), 0] : [0, c.charCodeAt(0)])),
  );
const hexOf = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * How "CNBZ1:" can look inside a file: plain (EXIF, PNG, ID3, Vorbis), as
 * UTF-16 (ID3, EXIF) and as a hex string of UTF-16 (PDF properties).
 */
const SEALED_PATTERNS: Uint8Array[] = [
  enc.encode(SEALED_PREFIX),
  utf16(SEALED_PREFIX, true),
  utf16(SEALED_PREFIX, false),
  enc.encode(hexOf(utf16(SEALED_PREFIX, false)).toUpperCase()),
  enc.encode(hexOf(utf16(SEALED_PREFIX, false))),
];
const LONGEST = Math.max(...SEALED_PATTERNS.map((p) => p.length));

/** Locked messages from "Secret message in metadata", anywhere in the file. */
export async function sealedSecrets(reader: ByteReader, limit = 20): Promise<SecretFinding[]> {
  const out: SecretFinding[] = [];
  for (let start = 0; start < reader.size && out.length < limit; start += WINDOW) {
    const buf = await reader.read(start, WINDOW + LONGEST);
    const end = Math.min(WINDOW, buf.length);
    for (let i = 0; i < end && out.length < limit; i++) {
      for (const pattern of SEALED_PATTERNS) {
        if (buf[i] !== pattern[0]) continue;
        let ok = true;
        for (let k = 1; k < pattern.length && ok; k++) ok = buf[i + k] === pattern[k];
        if (!ok) continue;
        out.push({
          kind: 'sealed',
          offset: start + i,
          length: pattern.length,
          key: 'sealedMeta',
          trick: 'metasecret',
        });
        i += pattern.length - 1;
        break;
      }
    }
  }
  return out;
}
