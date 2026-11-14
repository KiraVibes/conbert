import { describe, expect, it } from 'vitest';
import { lyricsAss, visualizerColors } from './visualizer';
import { assColor, brightness, coverPalette, liftForDark, resolveColor } from './visualizer-style';

/** A small picture: mostly dark blue, some strong orange, a bit of white. */
function picture(): Uint8Array {
  const px: number[] = [];
  for (let i = 0; i < 100; i++) px.push(20, 30, 90);
  for (let i = 0; i < 40; i++) px.push(240, 120, 20);
  for (let i = 0; i < 10; i++) px.push(250, 250, 250);
  return new Uint8Array(px);
}

describe('visualizer colours', () => {
  it('finds the strong colours of a cover, the most striking first', () => {
    const palette = coverPalette(picture(), 3, 6);
    expect(palette.length).toBeGreaterThanOrEqual(2);
    // Orange is more colourful and brighter than the dull blue.
    expect(palette[0]).toMatch(/^#f/);
    expect(palette.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });

  it('brightens dark colours so they show on the dark background', () => {
    expect(brightness(liftForDark('#200010'))).toBeGreaterThan(brightness('#200010'));
    expect(liftForDark('#ffffff')).toBe('#ffffff');
  });

  it('resolves names, own colours, the cover and "like the wave"', () => {
    expect(resolveColor('red', '#000000', null)).toBe('#f87171');
    expect(resolveColor('#12AB34', '#000000', null)).toBe('#12ab34');
    expect(resolveColor('cover', '#000000', '#ff8800')).toBe('#ff8800');
    expect(resolveColor('wave', '#000000', null, '#00ff00')).toBe('#00ff00');
    expect(resolveColor('nonsense; drop', '#ffffff', null)).toBe('#ffffff');
    expect(visualizerColors({ vizColor: 'cover', vizTextColor: 'wave' }, '#336699')).toEqual({
      wave: liftForDark('#336699'),
      text: liftForDark('#336699'),
    });
  });

  it('writes ASS colours as blue-green-red', () => {
    expect(assColor('#a78bfa')).toBe('&H00FA8BA7');
    expect(assColor('#000000', 0x80)).toBe('&H80000000');
  });

  it('puts font, colour and a contrasting outline into the lyrics style', () => {
    const cue = [{ start: 0, end: 1000, text: 'Hallo' }];
    const ass = lyricsAss(
      cue,
      { vizFont: 'script', vizTextColor: 'black', vizTextSize: 'large' },
      true,
    );
    const style = ass.split('\n').find((l) => l.startsWith('Style: Lyrics')) ?? '';
    expect(style).toContain('Z003');
    // Black letters → light outline.
    expect(style).toContain(`${assColor('#111111')},${assColor('#111111')},${assColor('#f5f5f5')}`);
    const big = Number(style.split(',')[2]);
    const normal = Number(
      (
        lyricsAss(cue, {}, true)
          .split('\n')
          .find((l) => l.startsWith('Style: Lyrics')) ?? ''
      ).split(',')[2],
    );
    expect(big).toBeGreaterThan(normal);
  });
});
