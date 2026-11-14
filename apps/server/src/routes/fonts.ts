import { createReadStream, existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { LYRICS_FONTS, type LyricsFont } from '@conbert/core';
import { HttpError } from '../lib/http-error';

const URW = '/usr/share/fonts/opentype/urw-base35';
const DEJAVU = '/usr/share/fonts/truetype/dejavu';

/**
 * The font files libass uses for the lyrics (Debian packages fonts-dejavu-core
 * and fonts-urw-base35). Sent to the browser so the font list can show each
 * font in its own look. Fixed paths – nothing from the request reaches the path.
 */
export const LYRICS_FONT_FILES: Record<LyricsFont, string> = {
  sans: `${DEJAVU}/DejaVuSans-Bold.ttf`,
  serif: `${DEJAVU}/DejaVuSerif-Bold.ttf`,
  elegant: `${URW}/P052-Roman.otf`,
  modern: `${URW}/URWGothic-Book.otf`,
  narrow: `${URW}/NimbusSansNarrow-Bold.otf`,
  classic: `${URW}/URWBookman-Light.otf`,
  typewriter: `${DEJAVU}/DejaVuSansMono.ttf`,
  script: `${URW}/Z003-MediumItalic.otf`,
};

export function registerFontRoutes(app: FastifyInstance): void {
  app.get<{ Params: { font: string } }>('/api/fonts/lyrics/:font', async (req, reply) => {
    const font = LYRICS_FONTS.find((f) => f === req.params.font);
    const file = font ? LYRICS_FONT_FILES[font] : undefined;
    // Missing outside the Docker image (e.g. local development) – the browser
    // then falls back to a similar font of the device.
    if (!file || !existsSync(file)) throw new HttpError(404, 'NOT_FOUND', 'Font not available');
    return reply
      .type(file.endsWith('.otf') ? 'font/otf' : 'font/ttf')
      .header('Cache-Control', 'private, max-age=604800')
      .send(createReadStream(file));
  });
}
