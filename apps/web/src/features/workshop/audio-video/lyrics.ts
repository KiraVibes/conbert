import { useEffect, useState } from 'react';
import {
  COLOR_HEX,
  FONT_FAMILY,
  LYRICS_FILE_TYPES,
  LYRICS_FONTS,
  isHexColor,
  coverPalette,
  type LyricsFont,
  type LyricsSource,
  type WhisperLanguage,
} from '@conbert/core';
import { useAvailableEngines } from '@/engines/use-engines';
import { useCan } from '@/features/auth/use-auth';
import { extOf } from '../audio-convert';

export interface LyricsChoice {
  source: LyricsSource;
  file: File | null;
  language: WhisperLanguage;
}

/** Is speech recognition (Whisper) there and allowed for this user? */
export function useSpeechAvailable(): boolean {
  const { engines, serverAvailable } = useAvailableEngines();
  const allowed = useCan('ai');
  const whisper = engines.find((e) => e.id === 'whisper' && e.runtime === 'server');
  return serverAvailable && allowed && whisper !== undefined && whisper.status !== 'error';
}

export const lyricsFileOk = (file: File | null) =>
  !file || LYRICS_FILE_TYPES.includes(extOf(file.name));

/** The strongest colours of the cover picture (worked out on this device). */
export function useCoverPalette(cover: File | null): string[] {
  const [state, setState] = useState<{ file: File; colours: string[] } | null>(null);
  useEffect(() => {
    if (!cover) return;
    let alive = true;
    void (async () => {
      const bitmap = await createImageBitmap(cover);
      const canvas = new OffscreenCanvas(64, 64);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0, 64, 64);
      bitmap.close();
      const colours = coverPalette(ctx.getImageData(0, 0, 64, 64).data, 4, 6);
      if (alive) setState({ file: cover, colours });
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [cover]);
  return cover && state?.file === cover ? state.colours : [];
}

/** The colour a choice stands for (for the swatch); "cover"/"wave" have none of their own. */
export function swatchHex(value: string): string | null {
  if (isHexColor(value)) return value;
  return value in COLOR_HEX ? COLOR_HEX[value as keyof typeof COLOR_HEX] : null;
}

const fontName = (font: LyricsFont) => `Conbert Lyrics ${font}`;

/** CSS font stack: the server's own font first, a similar device font after. */
export function lyricsFontCss(font: LyricsFont): string {
  return `"${fontName(font)}", ${FONT_FAMILY[font].css}`;
}

let fontsRequested = false;

/**
 * Loads the server's lyrics fonts (the ones the video uses), so the font list
 * and the preview show the real look. Once per page; a font the server lacks
 * just stays on the device's fallback.
 */
export function useLyricsFonts(): void {
  useEffect(() => {
    if (fontsRequested || typeof FontFace === 'undefined') return;
    fontsRequested = true;
    for (const font of LYRICS_FONTS) {
      const face = new FontFace(fontName(font), `url(/api/fonts/lyrics/${font})`, {
        display: 'swap',
      });
      document.fonts.add(face);
      face.load().catch(() => document.fonts.delete(face));
    }
  }, []);
}
