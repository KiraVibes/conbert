import { randomFillSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ShamirError,
  atbash,
  caesar,
  combineShares,
  findShares,
  crackCaesar,
  crackVigenere,
  fromBraille,
  fromMorse,
  morseTiming,
  parseShare,
  rot13,
  splitSecret,
  toBraille,
  toMorse,
  vigenere,
} from './index';

const random = (bytes: Uint8Array) => randomFillSync(bytes);

describe('treasure map (Shamir)', () => {
  it('any 3 of 5 parts bring a text back', () => {
    const parts = splitSecret(
      { kind: 'text', text: 'Der Schatz liegt unter der Eiche 🌳' },
      5,
      3,
      random,
    );
    expect(parts).toHaveLength(5);
    for (const pick of [
      [0, 1, 2],
      [4, 2, 0],
      [1, 3, 4],
      [0, 1, 2, 3, 4],
    ]) {
      const secret = combineShares(pick.map((i) => parts[i] ?? ''));
      expect(secret).toEqual({ kind: 'text', text: 'Der Schatz liegt unter der Eiche 🌳' });
    }
  });

  it('keeps files with their names', () => {
    const data = Uint8Array.from({ length: 3000 }, (_, i) => i % 251);
    const parts = splitSecret({ kind: 'file', name: 'schluessel.txt', data }, 3, 2, random);
    expect(combineShares([parts[2] ?? '', parts[0] ?? ''])).toEqual({
      kind: 'file',
      name: 'schluessel.txt',
      data,
    });
  });

  it('says what is wrong with the parts', () => {
    const parts = splitSecret({ kind: 'text', text: 'geheim' }, 4, 3, random);
    const other = splitSecret({ kind: 'text', text: 'anderes' }, 4, 3, random);
    const code = (fn: () => unknown) => {
      try {
        fn();
        return null;
      } catch (e) {
        return e instanceof ShamirError ? e.code : String(e);
      }
    };
    expect(code(() => combineShares(parts.slice(0, 2)))).toBe('too-few');
    expect(code(() => combineShares([parts[0] ?? '', parts[1] ?? '', other[2] ?? '']))).toBe(
      'mixed',
    );
    expect(code(() => combineShares([parts[0] ?? '', parts[0] ?? '', parts[1] ?? '']))).toBe(
      'duplicate',
    );
    // One wrong character: the part's checksum notices it.
    const fields = (parts[1] ?? '').split(':');
    const data = fields[5] ?? '';
    fields[5] = (data[0] === 'A' ? 'B' : 'A') + data.slice(1);
    const typo = fields.join(':');
    expect(code(() => parseShare(typo))).toBe('damaged');
    expect(code(() => parseShare('hallo'))).toBe('not-a-share');
    expect(code(() => splitSecret({ kind: 'text', text: 'x' }, 2, 3, random))).toBe('bad-count');
    // Pasted with line breaks inside and between the parts.
    const wrapped = (parts[0] ?? '').replace(/(.{20})/g, '$1\n');
    const pasted = `Teil A:\n${wrapped}\n\n${parts[2] ?? ''} ${parts[3] ?? ''}`;
    expect(combineShares(findShares(pasted))).toEqual({ kind: 'text', text: 'geheim' });
    // Fewer parts than needed tell nothing: two parts fit any secret.
    expect(parseShare(parts[0] ?? '')).toMatchObject({ needed: 3, x: 1 });
  });
});

describe('ciphers', () => {
  it('Caesar, ROT13 and Atbash go back and forth', () => {
    expect(caesar('Hallo, Welt!', 3)).toBe('Kdoor, Zhow!');
    expect(caesar(caesar('Grüße', 7), -7)).toBe('Grüße');
    expect(rot13(rot13('Geheim'))).toBe('Geheim');
    expect(atbash('Abc xyz')).toBe('Zyx cba');
  });

  it('Vigenère uses the key word letter by letter', () => {
    expect(vigenere('ATTACKATDAWN', 'LEMON')).toBe('LXFOPVEFRNHR');
    expect(vigenere('LXFOPVEFRNHR', 'LEMON', true)).toBe('ATTACKATDAWN');
  });

  it('Morse and Braille, and back', () => {
    expect(toMorse('SOS Hilfe')).toBe('... --- ... / .... .. .-.. ..-. .');
    expect(fromMorse('... --- ... / .... .. .-.. ..-. .')).toBe('SOS HILFE');
    expect(morseTiming('.- / -')).toEqual([
      { on: true, units: 1 },
      { on: false, units: 1 },
      { on: true, units: 3 },
      { on: false, units: 7 },
      { on: true, units: 3 },
    ]);
    const braille = toBraille('Hallo 42');
    expect(braille).toBe('⠠⠓⠁⠇⠇⠕⠀⠼⠙⠃');
    expect(fromBraille(braille)).toBe('Hallo 42');
  });

  it('cracks Caesar and Vigenère on ordinary text', () => {
    const plain =
      'Die Werkstatt von Conbert zeigt, dass alte Geheimschriften leicht zu knacken sind, weil Buchstaben in jeder Sprache unterschiedlich oft vorkommen.';
    expect(crackCaesar(caesar(plain, 11))[0]).toMatchObject({ shift: 11, text: plain });
    expect(crackVigenere(vigenere(plain, 'ZAUBER'))).toEqual({
      key: 'ZAUBER',
      text: plain,
      longest: 8,
    });
    // Too short to guess a long key – but with the length given, it works.
    const short =
      'Morgen treffen wir uns am alten Brunnen hinter der Kirche, bring bitte die Karte mit.';
    expect(crackVigenere(vigenere(short, 'ZAUBER'), 12, 6)?.key).toBe('ZAUBER');
    expect(crackVigenere('zu kurz')).toBeNull();
  });
});
