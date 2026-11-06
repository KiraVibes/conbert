import { describe, expect, it } from 'vitest';
import {
  countInvisible,
  findInvisible,
  guessBinaryMessage,
  hideInText,
  peekHiddenText,
  revealFromText,
  stripInvisible,
} from './zero-width';

const ch = (...codes: number[]) => String.fromCodePoint(...codes);

describe('invisible text', () => {
  it('hides a message that looks like nothing and reads it back', async () => {
    const cover = 'Treffen wir uns morgen?';
    const hidden = await hideInText(cover, 'Um 7 am Brunnen 🌙');
    expect(stripInvisible(hidden)).toBe(cover);
    expect(hidden.startsWith('Treffen')).toBe(true);
    expect(peekHiddenText(hidden)).toEqual({ encrypted: false, characters: expect.any(Number) });
    expect(await revealFromText(hidden)).toBe('Um 7 am Brunnen 🌙');
  });

  it('locks the message with a password', async () => {
    const hidden = await hideInText('Hallo', 'geheim', 'pw');
    expect(peekHiddenText(hidden)?.encrypted).toBe(true);
    await expect(revealFromText(hidden)).rejects.toMatchObject({ code: 'needs-password' });
    await expect(revealFromText(hidden, 'falsch')).rejects.toMatchObject({
      code: 'wrong-password',
    });
    expect(await revealFromText(hidden, 'pw')).toBe('geheim');
  }, 20_000);

  it('notices a damaged message and plain text', async () => {
    const hidden = await hideInText('Hallo Welt', 'eine längere Nachricht');
    const cut = hidden.slice(0, hidden.length - 30) + ' Welt';
    await expect(revealFromText(cut)).rejects.toMatchObject({ code: 'damaged' });
    await expect(revealFromText('nur Text')).rejects.toMatchObject({ code: 'nothing-hidden' });
    expect(peekHiddenText('nur Text')).toBeNull();
  });

  it('reads binary messages from other tools', () => {
    const bits = [...'Hi']
      .flatMap((c) => c.charCodeAt(0).toString(2).padStart(8, '0').split(''))
      .map((b) => (b === '1' ? ch(0x200c) : ch(0x200b)))
      .join('');
    expect(guessBinaryMessage(`Hallo${bits} Welt`)).toBe('Hi');
    expect(guessBinaryMessage('Hallo Welt')).toBeNull();
  });
});

describe('finding invisible characters', () => {
  it('finds and names them', () => {
    const text = `a${ch(0x200b, 0x200b)}b${ch(0x202e)}c${ch(0xad)}d${ch(0xa0)}e${ch(0x3164)}`;
    const runs = findInvisible(text);
    expect(runs.map((r) => [r.kind, r.count])).toEqual([
      ['zero-width', 2],
      ['bidi', 1],
      ['soft-hyphen', 1],
      ['space', 1],
      ['filler', 1],
    ]);
    expect(countInvisible(runs)).toMatchObject({ 'zero-width': 2, bidi: 1 });
    expect(stripInvisible(text)).toBe('abcd e');
  });

  it('leaves emoji and byte order marks alone', () => {
    const family = ch(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const heart = ch(0x2764, 0xfe0f);
    const scotland = ch(0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f);
    expect(findInvisible(`${ch(0xfeff)}Hi ${family} ${heart} ${scotland}`)).toEqual([]);
  });

  it('spells out text hidden in tags and variation selectors', () => {
    const tags = [...'run rm'].map((c) => ch(0xe0000 + c.charCodeAt(0))).join('');
    expect(findInvisible(`Bitte zusammenfassen.${tags}`)[0]).toMatchObject({
      kind: 'tag',
      decoded: 'run rm',
    });
    // "Hi" as bytes: H = 0x48 → U+E0100 + 0x38, i = 0x69 → U+E0100 + 0x59
    const smuggled = `😀${ch(0xe0100 + 0x48 - 16, 0xe0100 + 0x69 - 16)}`;
    expect(findInvisible(smuggled)[0]).toMatchObject({ kind: 'variation', decoded: 'Hi' });
  });
});
