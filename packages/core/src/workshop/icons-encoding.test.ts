import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  dataUri,
  decodeAny,
  decodeText,
  encodeText,
  hexToBytes,
  parseDataUri,
} from './encoding';
import { buildIcns, buildIco, faviconHtml, webManifest } from './icons';

const fakePng = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...Array(n).fill(n)]);

describe('icon files', () => {
  it('writes an ICO with PNG entries', () => {
    const ico = buildIco([
      { size: 16, png: fakePng(3) },
      { size: 256, png: fakePng(5) },
    ]);
    const view = new DataView(ico.buffer);
    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2, true)).toBe(1);
    expect(view.getUint16(4, true)).toBe(2);
    expect(ico[6]).toBe(16);
    expect(ico[22]).toBe(0); // 256 is written as 0
    const first = view.getUint32(6 + 12, true);
    expect(first).toBe(6 + 32);
    expect(view.getUint32(6 + 8, true)).toBe(7);
    expect([...ico.slice(first, first + 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(view.getUint32(22 + 12, true)).toBe(first + 7);
    expect(ico.length).toBe(38 + 7 + 9);
  });

  it('writes an ICNS with the sizes it has', () => {
    const icns = buildIcns(
      new Map([
        [16, fakePng(1)],
        [32, fakePng(2)],
      ]),
    );
    const text = (at: number) => String.fromCharCode(...icns.slice(at, at + 4));
    const view = new DataView(icns.buffer);
    expect(text(0)).toBe('icns');
    expect(view.getUint32(4)).toBe(icns.length);
    // 16 → icp4; 32 → icp5 and ic11 (16@2x).
    expect(text(8)).toBe('icp4');
    expect(view.getUint32(12)).toBe(8 + 5);
    expect(text(8 + 13)).toBe('icp5');
    expect(text(8 + 13 + 14)).toBe('ic11');
  });

  it('describes the icons for browsers and phones', () => {
    const manifest = JSON.parse(
      webManifest({
        name: 'Mein Shop',
        shortName: '',
        themeColor: '#123456',
        backgroundColor: '#fff',
      }),
    ) as { short_name: string; icons: { purpose?: string }[] };
    expect(manifest.short_name).toBe('Mein Shop');
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(faviconHtml('#12ab34')).toContain('content="#12ab34"');
    expect(faviconHtml('#12ab34"><script>')).toContain('content="#ffffff"');
  });
});

describe('encodings', () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);

  it('round-trips Base64 in both alphabets', () => {
    expect(bytesToBase64(bytes)).toBe('AAH6+/z9/v8=');
    expect(bytesToBase64(bytes, true)).toBe('AAH6-_z9_v8');
    expect([...(base64ToBytes('AAH6-_z9_v8') ?? [])]).toEqual([...bytes]);
    expect([...(base64ToBytes(' AAH6\n+/z9/v8= ') ?? [])]).toEqual([...bytes]);
    expect(base64ToBytes('ab$c')).toBeNull();
    expect(base64ToBytes('a')).toBeNull();
  });

  it('round-trips hex in many spellings', () => {
    expect(bytesToHex(new Uint8Array([0x48, 0x69]))).toBe('4869');
    expect([...(hexToBytes('0x48, 0x69') ?? [])]).toEqual([0x48, 0x69]);
    expect([...(hexToBytes('48:69') ?? [])]).toEqual([0x48, 0x69]);
    expect(hexToBytes('486')).toBeNull();
  });

  it('encodes and decodes text, umlauts included', () => {
    for (const codec of ['base64', 'base64url', 'hex', 'url'] as const) {
      expect(decodeText(encodeText('Grüße & 🧙', codec), codec)).toEqual({
        ok: true,
        text: 'Grüße & 🧙',
      });
    }
    expect(decodeText('%E0%A4%A', 'url')).toEqual({ ok: false, reason: 'invalid' });
    expect(decodeText('/w==', 'base64')).toMatchObject({ ok: false, reason: 'binary' });
  });

  it('reads data URIs and guesses pasted text', () => {
    const uri = dataUri(new Uint8Array([1, 2, 3]), 'image/png');
    expect(uri).toBe('data:image/png;base64,AQID');
    expect(parseDataUri(uri)).toEqual({ mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    expect(parseDataUri('data:,Hallo%20Welt')).toEqual({
      mime: 'text/plain',
      bytes: new TextEncoder().encode('Hallo Welt'),
    });
    expect(decodeAny('48 65 6c 6c 6f')?.from).toBe('hex');
    expect(decodeAny('SGVsbG8=')?.from).toBe('base64');
    expect(decodeAny('kein base64 !')).toBeNull();
  });
});
