/**
 * Checksums: the computing happens elsewhere (hash-wasm in the browser);
 * this part reads a pasted checksum and says whether it fits.
 */

export const HASH_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha512', 'crc32', 'blake3'] as const;
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

/** Length of the hex text per algorithm. */
export const HASH_HEX_LENGTH: Record<HashAlgorithm, number> = {
  md5: 32,
  sha1: 40,
  sha256: 64,
  sha512: 128,
  crc32: 8,
  blake3: 64,
};

export const HASH_LABELS: Record<HashAlgorithm, string> = {
  md5: 'MD5',
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  sha512: 'SHA-512',
  crc32: 'CRC32',
  blake3: 'BLAKE3',
};

const LENGTHS = new Set(Object.values(HASH_HEX_LENGTH));

/**
 * The checksum in a pasted text: "SHA256: AB CD …", "ab:cd:…", a line of
 * `sha256sum` ("<hash>  datei.zip") – lower-case hex, or null.
 */
export function parseHashInput(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(
      /^(md5|sha-?1|sha-?256|sha-?512|crc-?32|blake3|hash|checksum|prüfsumme)\s*[:=]?\s*/i,
      '',
    );
  // Bytes separated by spaces or colons ("AB:CD:EF" / "ab cd ef").
  const separated = /^([0-9a-f]{2}([ :-][0-9a-f]{2})+)\b/i.exec(cleaned);
  if (separated?.[1]) {
    const hex = separated[1].replace(/[ :-]/g, '').toLowerCase();
    if (LENGTHS.has(hex.length)) return hex;
  }
  for (const match of cleaned.matchAll(/[0-9a-f]+/gi)) {
    if (LENGTHS.has(match[0].length)) return match[0].toLowerCase();
  }
  return null;
}

/** Which algorithms produce a checksum this long? */
export function algorithmsForLength(length: number): HashAlgorithm[] {
  return HASH_ALGORITHMS.filter((a) => HASH_HEX_LENGTH[a] === length);
}

export type HashComparison =
  | { status: 'match'; algorithm: HashAlgorithm }
  | { status: 'different'; algorithms: HashAlgorithm[] }
  /** The fitting algorithm hasn't been computed (switched off). */
  | { status: 'not-computed'; algorithms: HashAlgorithm[] }
  | { status: 'invalid' };

export function compareHash(
  input: string,
  results: Partial<Record<HashAlgorithm, string>>,
): HashComparison {
  const hash = parseHashInput(input);
  if (!hash) return { status: 'invalid' };
  const algorithms = algorithmsForLength(hash.length);
  const match = algorithms.find((a) => results[a]?.toLowerCase() === hash);
  if (match) return { status: 'match', algorithm: match };
  const computed = algorithms.filter((a) => results[a] !== undefined);
  return computed.length > 0
    ? { status: 'different', algorithms: computed }
    : { status: 'not-computed', algorithms };
}

/** A checksum file in the usual `sha256sum` format ("<hash>  <name>"). */
export function checksumFile(hash: string, fileName: string): string {
  return `${hash}  ${fileName}\n`;
}
