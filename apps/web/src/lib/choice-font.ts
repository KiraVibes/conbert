import { useEffect } from 'react';
import type { ChoiceFont } from '@conbert/core';

const requested = new Set<string>();

/** CSS for a choice shown in its own font: the loaded font first, the fallback after. */
export function choiceFontStyle(font: ChoiceFont): React.CSSProperties {
  return {
    fontFamily: `"${font.name}", ${font.fallback}`,
    fontWeight: font.bold ? 700 : 400,
  };
}

/**
 * Loads the font files of these choices (once per page). A font that can't be
 * loaded – e.g. the server is missing it – just stays on the fallback.
 */
export function useChoiceFonts(fonts: readonly (ChoiceFont | undefined)[]): void {
  const key = JSON.stringify(fonts.flatMap((f) => (f?.url ? [[f.name, f.url] as const] : [])));
  useEffect(() => {
    if (typeof FontFace === 'undefined') return;
    for (const [name, url] of JSON.parse(key) as [string, string][]) {
      if (requested.has(name)) continue;
      requested.add(name);
      const face = new FontFace(name, `url(${url})`, { display: 'swap' });
      document.fonts.add(face);
      face.load().catch(() => document.fonts.delete(face));
    }
  }, [key]);
}
