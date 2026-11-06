import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/** OWASP recommendation for Argon2id: 19 MiB memory, 2 passes, 1 lane. */
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

function derive(
  password: string,
  salt: Buffer,
  p: { memory: number; passes: number; parallelism: number; tagLength: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: password, nonce: salt, ...p }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Hashes a password with Argon2id (built into Node 24). Returns a PHC string. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(key)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** Checks a password against a PHC string in constant time. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const match = PHC.exec(hash);
  if (!match) return false;
  const [, m, t, p, saltB64, keyB64] = match;
  const expected = Buffer.from(keyB64 ?? '', 'base64');
  const key = await derive(password, Buffer.from(saltB64 ?? '', 'base64'), {
    memory: Number(m),
    passes: Number(t),
    parallelism: Number(p),
    tagLength: expected.length,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hash of a random password, used to keep timing equal for unknown users. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
