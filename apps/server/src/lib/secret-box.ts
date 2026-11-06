import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Encrypts stored credentials (passwords, keys of storage locations …) with
 * AES-256-GCM. The key comes from CONBERT_SECRET; without it, a random key is
 * created once in the data folder (readable only by Conbert).
 */

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

export interface SecretBox {
  /** `context` binds the ciphertext to its row (e.g. owner + id), so it can't be moved. */
  encrypt(plaintext: string, context: string): string;
  decrypt(ciphertext: string, context: string): string;
  /** Where the key came from – for a hint in the log. */
  source: 'env' | 'file';
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(secret, 'utf8'), 'conbert', 'conbert credentials v1', 32),
  );
}

/** Reads the generated key, or creates it (only when it doesn't exist yet). */
function fileKey(file: string): Buffer {
  try {
    const stored = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
    if (stored.length !== 32) throw new SecretBoxError(`${file} does not hold a 32-byte key`);
    return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const key = randomBytes(32);
  // 'wx': never overwrite a key that appeared in the meantime.
  writeFileSync(file, `${key.toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600);
  return key;
}

export function createSecretBox(secret: string | undefined, keyFile: string): SecretBox {
  const key = secret ? deriveKey(secret) : fileKey(keyFile);
  return {
    source: secret ? 'env' : 'file',
    encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
    },
    decrypt(ciphertext, context) {
      const [version, data] = ciphertext.split('.', 2);
      if (version !== VERSION || !data) throw new SecretBoxError('unknown format');
      const raw = Buffer.from(data, 'base64');
      if (raw.length < IV_BYTES + TAG_BYTES) throw new SecretBoxError('too short');
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      try {
        return Buffer.concat([
          decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        // Wrong key (CONBERT_SECRET changed) or tampered data.
        throw new SecretBoxError('cannot decrypt');
      }
    },
  };
}
