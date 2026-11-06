/**
 * Key vault: every account can have an age key pair. The private key is made
 * and locked (with its own vault password, scrypt) in the browser; the server
 * only ever stores the locked form and the public key.
 */

/** An age public key ("age1…", X25519, or the post-quantum "age1pq1…"). */
const RECIPIENT = /^age1(?:pq1)?[02-9ac-hj-np-z]{40,3000}$/;

export function isAgeRecipient(text: string): boolean {
  return RECIPIENT.test(text.trim());
}

/** Public keys from pasted text (one per line, or separated by spaces/commas). */
export function parseRecipients(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  // Lines starting with "#" are comments (as in age's own recipient files).
  const withoutComments = text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  for (const part of withoutComments.split(/[\s,;]+/)) {
    const key = part.trim();
    if (!key) continue;
    if (isAgeRecipient(key)) {
      if (!valid.includes(key)) valid.push(key);
    } else invalid.push(key);
  }
  return { valid, invalid };
}

export const ARMOR_BEGIN = '-----BEGIN AGE ENCRYPTED FILE-----';
export const ARMOR_END = '-----END AGE ENCRYPTED FILE-----';

/** Longer than any real locked key (a few hundred bytes) – nothing else is accepted. */
export const MAX_LOCKED_KEY_LENGTH = 8 * 1024;

/**
 * Is this a private key locked with a password (age, scrypt) – and nothing
 * else? The server checks it so that an unlocked key never gets stored by
 * mistake.
 */
export function isLockedIdentity(armored: string): boolean {
  const text = armored.trim();
  if (text.length > MAX_LOCKED_KEY_LENGTH) return false;
  if (!text.startsWith(ARMOR_BEGIN) || !text.endsWith(ARMOR_END)) return false;
  if (/AGE-SECRET-KEY/i.test(text)) return false;
  const body = text.slice(ARMOR_BEGIN.length, -ARMOR_END.length).replace(/\s+/g, '');
  let header: string;
  try {
    header = atob(body.slice(0, 64));
  } catch {
    return false;
  }
  // The file says what it is locked with: a password (scrypt) and only that.
  return header.startsWith('age-encryption.org/v1\n-> scrypt ');
}

/** "foto.jpg" → "foto.jpg.age"; "foto.jpg.age" → "foto.jpg" (or "foto" + "-entschlüsselt"). */
export function encryptedName(name: string): string {
  return `${name}.age`;
}

export function decryptedName(name: string, fallbackSuffix = 'decrypted'): string {
  return /\.age$/i.test(name) ? name.slice(0, -4) : `${name}-${fallbackSuffix}`;
}
