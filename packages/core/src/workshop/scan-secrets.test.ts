import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bytesReader,
  detectiveScan,
  encodePng,
  encodeWav,
  hideInCarrier,
  hideInRaster,
  hideInText,
  sealMessage,
  wavCarrier,
  type Raster,
} from './index';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../apps/web/src/engines/__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const scan = async (bytes: Uint8Array, ext: string | null) =>
  (await detectiveScan(bytesReader(bytes), ext)).findings;

/** A picture with only even colour values – like many real pictures, the pairs are uneven. */
function evenPicture(size = 96): Raster {
  const data = new Uint8Array(size * size * 3);
  for (let i = 0; i < data.length; i++) data[i] = 2 * Math.floor(Math.random() * 128);
  return { width: size, height: size, channels: 3, data };
}

describe('detective scan: traces of the hiding tricks', () => {
  it('finds a Conbert message in a picture, open or locked', async () => {
    const open = encodePng(await hideInRaster(evenPicture(), { kind: 'text', text: 'Hallo' }));
    expect(await scan(open, 'png')).toContainEqual(
      expect.objectContaining({ kind: 'stego', key: 'stegoPicture', trick: 'stego', hidden: true }),
    );
    const locked = encodePng(
      await hideInRaster(evenPicture(), { kind: 'text', text: 'Hallo' }, { password: 'pw' }),
    );
    expect(await scan(locked, 'png')).toContainEqual(
      expect.objectContaining({ key: 'stegoPictureLocked' }),
    );
  }, 20_000);

  it('flags lowest bits that look filled from the top', async () => {
    const picture = evenPicture();
    // Random bits in the top 40 % – what other steganography tools leave behind.
    for (let i = 0; i < picture.data.length * 0.4; i++) {
      picture.data[i] = ((picture.data[i] ?? 0) & 0xfe) | (Math.random() < 0.5 ? 1 : 0);
    }
    const findings = await scan(encodePng(picture), 'png');
    expect(findings).toContainEqual(
      expect.objectContaining({ kind: 'lsb', key: 'lsbSuspicious', trick: 'stego' }),
    );
  });

  it('finds a Conbert message in a WAV file', async () => {
    const samples = Float32Array.from({ length: 20_000 }, (_, i) => Math.sin(i / 9) * 0.4);
    const wav = encodeWav(samples, 8000);
    const hidden = await hideInCarrier(wavCarrier(wav), { kind: 'text', text: 'leise' });
    expect(await scan(hidden, 'wav')).toContainEqual(
      expect.objectContaining({ key: 'stegoAudio', trick: 'audiostego', offset: 44 }),
    );
    expect(await scan(wav, 'wav')).toEqual([]);
  });

  it('names a zero-width message instead of just counting characters', async () => {
    const text = new TextEncoder().encode(await hideInText('Bis morgen!', 'Brunnen'));
    const findings = await scan(text, null);
    expect(findings).toEqual([
      expect.objectContaining({ key: 'zeroWidthMessage', trick: 'invisible' }),
    ]);
  });

  it('finds locked metadata messages, also in the hex form of PDFs', async () => {
    const sealed = await sealMessage('geheim', 'pw');
    const hexUtf16 = [...sealed]
      .map((c) => c.charCodeAt(0).toString(16).padStart(4, '0'))
      .join('')
      .toUpperCase();
    const file = new TextEncoder().encode(
      `%PDF-1.7\n1 0 obj << /Subject <FEFF${hexUtf16}> >> endobj\n% comment ${sealed}\n`,
    );
    const findings = (await scan(file, null)).filter((f) => f.kind === 'sealed');
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ key: 'sealedMeta', trick: 'metasecret' });
  }, 20_000);

  it('stays quiet for normal pictures and sound', async () => {
    expect(await scan(fixture('sample.png'), 'png')).toEqual([]);
    expect(await scan(fixture('sample.wav'), 'wav')).toEqual([]);
  });
});
