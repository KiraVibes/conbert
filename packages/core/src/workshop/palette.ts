/**
 * Colour palette of a picture: its main colours (median cut, then refined
 * with a few rounds of k-means), with how much of the picture each covers.
 */

export interface PaletteColor {
  r: number;
  g: number;
  b: number;
  hex: string;
  /** Share of the (visible) picture, 0–1. */
  share: number;
}

export const PALETTE_EXPORTS = ['css', 'scss', 'json', 'gpl', 'txt'] as const;
export type PaletteExport = (typeof PALETTE_EXPORTS)[number];

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** At most this many pixels are looked at (evenly spread) – plenty for colours. */
const SAMPLES = 40_000;

/** The main colours of RGBA pixels, most common first. Transparent pixels don't count. */
export function extractPalette(rgba: Uint8ClampedArray, count = 6): PaletteColor[] {
  const total = rgba.length / 4;
  const stride = Math.max(1, Math.floor(total / SAMPLES));
  const px: number[] = [];
  for (let i = 0; i < total; i += stride) {
    const o = i * 4;
    if ((rgba[o + 3] ?? 0) < 128) continue;
    px.push(rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0);
  }
  const n = px.length / 3;
  if (n === 0) return [];
  // Median cut: split the box with the widest colour range until there are enough.
  let boxes: number[][] = [Array.from({ length: n }, (_, i) => i)];
  while (boxes.length < count) {
    let best = -1;
    let bestRange = 0;
    let bestChannel = 0;
    boxes.forEach((box, bi) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255;
        let hi = 0;
        for (const i of box) {
          const v = px[i * 3 + c] ?? 0;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        // Weighted by size: big boxes are split first.
        const range = (hi - lo) * Math.sqrt(box.length);
        if (range > bestRange) {
          bestRange = range;
          best = bi;
          bestChannel = c;
        }
      }
    });
    if (best < 0) break;
    const box = (boxes[best] ?? []).sort(
      (a, b) => (px[a * 3 + bestChannel] ?? 0) - (px[b * 3 + bestChannel] ?? 0),
    );
    const mid = Math.floor(box.length / 2);
    boxes = [...boxes.slice(0, best), box.slice(0, mid), box.slice(mid), ...boxes.slice(best + 1)];
  }
  let centers = boxes.map((box) => {
    const s = [0, 0, 0];
    for (const i of box) for (let c = 0; c < 3; c++) s[c] = (s[c] ?? 0) + (px[i * 3 + c] ?? 0);
    return s.map((v) => v / Math.max(1, box.length));
  });
  // k-means: every pixel to its nearest centre, centres to their pixels' mean.
  const assign = new Int32Array(n);
  for (let round = 0; round < 8; round++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const r = px[i * 3] ?? 0;
      const g = px[i * 3 + 1] ?? 0;
      const b = px[i * 3 + 2] ?? 0;
      let k = 0;
      let d0 = Infinity;
      centers.forEach((c, ci) => {
        const d = (r - (c[0] ?? 0)) ** 2 + (g - (c[1] ?? 0)) ** 2 + (b - (c[2] ?? 0)) ** 2;
        if (d < d0) {
          d0 = d;
          k = ci;
        }
      });
      assign[i] = k;
      const s = sums[k];
      if (s) {
        s[0] = (s[0] ?? 0) + r;
        s[1] = (s[1] ?? 0) + g;
        s[2] = (s[2] ?? 0) + b;
        s[3] = (s[3] ?? 0) + 1;
      }
    }
    centers = centers.map((c, ci) => {
      const s = sums[ci] ?? [0, 0, 0, 0];
      const m = s[3] ?? 0;
      return m ? [(s[0] ?? 0) / m, (s[1] ?? 0) / m, (s[2] ?? 0) / m] : c;
    });
  }
  const counts = centers.map(() => 0);
  for (let i = 0; i < n; i++) counts[assign[i] ?? 0] = (counts[assign[i] ?? 0] ?? 0) + 1;
  // Colours that ended up (almost) the same are one colour.
  const out: PaletteColor[] = [];
  centers.forEach((c, ci) => {
    const [r, g, b] = c.map((v) => Math.round(v)) as [number, number, number];
    const share = (counts[ci] ?? 0) / n;
    if (share === 0) return;
    const twin = out.find((o) => Math.abs(o.r - r) + Math.abs(o.g - g) + Math.abs(o.b - b) < 12);
    if (twin) twin.share += share;
    else out.push({ r, g, b, hex: toHex(r, g, b), share });
  });
  return out.sort((a, b) => b.share - a.share);
}

/** Black or white – whichever reads better on this colour. */
export function textOn(c: { r: number; g: number; b: number }): '#000000' | '#ffffff' {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  return l > 0.179 ? '#000000' : '#ffffff';
}

/** The palette as a file for design programs and code. */
export function paletteFile(
  colors: readonly PaletteColor[],
  kind: PaletteExport,
  name = 'palette',
) {
  const n = (i: number) => i + 1;
  switch (kind) {
    case 'css':
      return `:root {\n${colors.map((c, i) => `  --color-${n(i)}: ${c.hex};`).join('\n')}\n}\n`;
    case 'scss':
      return colors.map((c, i) => `$color-${n(i)}: ${c.hex};`).join('\n') + '\n';
    case 'json':
      return (
        JSON.stringify(
          colors.map((c) => ({ hex: c.hex, rgb: [c.r, c.g, c.b], share: +c.share.toFixed(4) })),
          null,
          2,
        ) + '\n'
      );
    case 'gpl':
      // GIMP / Inkscape / Krita palette.
      return (
        `GIMP Palette\nName: ${name.replace(/[\r\n]/g, ' ')}\nColumns: ${colors.length}\n#\n` +
        colors
          .map(
            (c) =>
              `${String(c.r).padStart(3)} ${String(c.g).padStart(3)} ${String(c.b).padStart(3)}\t${c.hex}`,
          )
          .join('\n') +
        '\n'
      );
    case 'txt':
      return colors.map((c) => c.hex).join('\n') + '\n';
  }
}
