import { armor, Encrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';
import { describe, expect, it } from 'vitest';
import {
  decryptedName,
  encryptedName,
  isAgeRecipient,
  isLockedIdentity,
  parseRecipients,
} from './vault';

describe('vault rules', () => {
  it('accepts age public keys only', async () => {
    const recipient = await identityToRecipient(await generateX25519Identity());
    expect(isAgeRecipient(recipient)).toBe(true);
    expect(isAgeRecipient('age1kurz')).toBe(false);
    expect(isAgeRecipient('ssh-ed25519 AAAA')).toBe(false);
    const { valid, invalid } = parseRecipients(`# Anna\n${recipient}, ${recipient}\nquatsch`);
    expect(valid).toEqual([recipient]);
    expect(invalid).toEqual(['quatsch']);
  });

  it('only lets a password-locked private key through', async () => {
    const identity = await generateX25519Identity();
    const locked = new Encrypter();
    locked.setPassphrase('ein sehr langes tresor passwort');
    locked.setScryptWorkFactor(10);
    const armored = armor.encode(await locked.encrypt(identity));
    expect(isLockedIdentity(armored)).toBe(true);
    // Locked for a key instead of a password, or not locked at all: refused.
    const forKey = new Encrypter();
    forKey.addRecipient(await identityToRecipient(identity));
    expect(isLockedIdentity(armor.encode(await forKey.encrypt(identity)))).toBe(false);
    expect(isLockedIdentity(identity)).toBe(false);
    expect(
      isLockedIdentity(
        `-----BEGIN AGE ENCRYPTED FILE-----\n${identity}\n-----END AGE ENCRYPTED FILE-----`,
      ),
    ).toBe(false);
  });

  it('names encrypted and decrypted files', () => {
    expect(encryptedName('foto.jpg')).toBe('foto.jpg.age');
    expect(decryptedName('foto.jpg.age')).toBe('foto.jpg');
    expect(decryptedName('geheim.bin')).toBe('geheim.bin-decrypted');
  });
});
