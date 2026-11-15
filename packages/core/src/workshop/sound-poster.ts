/**
 * Sound poster: a recording's waveform as a picture to print – bars, a
 * mirrored wave, a line or a ring – with a title and, if wanted, a QR code.
 * Built as SVG in millimetres, so it prints sharp at any size.
 */

export const POSTER_STYLES = ['bars', 'mirror', 'line', 'ring'] as const;
export type PosterStyle = (typeof POSTER_STYLES)[number];

export const POSTER_FORMATS = {
  a4: { w: 210, h: 297 },
  a3: { w: 297, h: 420 },
  square: { w: 300, h: 300 },
  wide: { w: 420, h: 210 },
} as const;
export type PosterFormat = keyof typeof POSTER_FORMATS;

export const POSTER_FONTS = ['serif', 'sans', 'script'] as const;
export type PosterFont = (typeof POSTER_FONTS)[number];

const FONT_STACKS: Record<PosterFont, string> = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: "'Helvetica Neue', Arial, sans-serif",
  script: "'Segoe Script', 'Brush Script MT', 'Comic Sans MS', cursive",
};

export interface PosterOptions {
  style: PosterStyle;
  format: PosterFormat;
  background: string;
  wave: string;
  text: string;
  font: PosterFont;
  title: string;
  subtitle: string;
  /** QR code modules (true = dark), or null. */
  qr: { count: number; dark: (x: number, y: number) => boolean } | null;
}

/**
 * Loudness per slice (0–1, loudest = 1): `count` values over the samples.
 * Peak per slice, softened a little so quiet parts stay visible.
 */
export function posterPeaks(samples: Float32Array, count: number): Float32Array {
  const out = new Float32Array(count);
  const step = samples.length / count;
  let max = 0;
  for (let i = 0; i < count; i++) {
    const from = Math.floor(i * step);
    const to = Math.max(from + 1, Math.floor((i + 1) * step));
    let peak = 0;
    let sum = 0;
    for (let k = from; k < to && k < samples.length; k++) {
      const v = Math.abs(samples[k] ?? 0);
      if (v > peak) peak = v;
      sum += v * v;
    }
    // Mix of peak and RMS: lively but not spiky.
    out[i] = 0.5 * peak + 0.5 * Math.sqrt(sum / Math.max(1, to - from));
    if ((out[i] ?? 0) > max) max = out[i] ?? 0;
  }
  if (max > 0) for (let i = 0; i < count; i++) out[i] = Math.sqrt((out[i] ?? 0) / max);
  return out;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
const n = (v: number) => Math.round(v * 100) / 100;

/** How many slices each style shows. */
export function posterSlices(style: PosterStyle): number {
  return style === 'ring' ? 180 : style === 'line' ? 600 : 120;
}

/** The poster as an SVG document (units: mm). */
export function soundPosterSvg(peaks: Float32Array, o: PosterOptions): string {
  const { w, h } = POSTER_FORMATS[o.format];
  const margin = Math.min(w, h) * 0.1;
  const textBlock =
    (o.title ? h * 0.07 : 0) + (o.subtitle ? h * 0.04 : 0) + (o.qr ? Math.min(w, h) * 0.18 : 0);
  const areaW = w - 2 * margin;
  const areaH = h - 2 * margin - textBlock;
  const cx = w / 2;
  const cy = margin + areaH / 2;
  const parts: string[] = [];
  const count = peaks.length;
  if (o.style === 'bars' || o.style === 'mirror') {
    const slot = areaW / count;
    const barW = slot * 0.62;
    for (let i = 0; i < count; i++) {
      const v = Math.max(0.02, peaks[i] ?? 0);
      const x = margin + i * slot + (slot - barW) / 2;
      if (o.style === 'mirror') {
        const bh = v * areaH;
        parts.push(
          `<rect x="${n(x)}" y="${n(cy - bh / 2)}" width="${n(barW)}" height="${n(bh)}" rx="${n(barW / 2)}"/>`,
        );
      } else {
        const bh = v * areaH;
        parts.push(
          `<rect x="${n(x)}" y="${n(margin + areaH - bh)}" width="${n(barW)}" height="${n(bh)}" rx="${n(barW / 2)}"/>`,
        );
      }
    }
    parts.unshift(`<g fill="${esc(o.wave)}">`);
    parts.push('</g>');
  } else if (o.style === 'line') {
    const pts: string[] = [];
    for (let i = 0; i < count; i++) {
      const x = margin + (i / (count - 1)) * areaW;
      // Up and down in turn, like an oscilloscope trace.
      const v = (peaks[i] ?? 0) * (i % 2 ? -1 : 1) * (areaH / 2);
      pts.push(`${n(x)},${n(cy - v)}`);
    }
    parts.push(
      `<polyline points="${pts.join(' ')}" fill="none" stroke="${esc(o.wave)}" stroke-width="${n(areaW / 600)}" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  } else {
    const r0 = Math.min(areaW, areaH) * 0.22;
    const r1 = Math.min(areaW, areaH) * 0.5;
    const lw = ((2 * Math.PI * r0) / count) * 0.55;
    parts.push(`<g stroke="${esc(o.wave)}" stroke-width="${n(lw)}" stroke-linecap="round">`);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * 2 * Math.PI - Math.PI / 2;
      const len = Math.max(0.03, peaks[i] ?? 0) * (r1 - r0);
      const x0 = cx + Math.cos(a) * r0;
      const y0 = cy + Math.sin(a) * r0;
      const x1 = cx + Math.cos(a) * (r0 + len);
      const y1 = cy + Math.sin(a) * (r0 + len);
      parts.push(`<line x1="${n(x0)}" y1="${n(y0)}" x2="${n(x1)}" y2="${n(y1)}"/>`);
    }
    parts.push('</g>');
  }
  let y = margin + areaH + h * 0.02;
  const font = FONT_STACKS[o.font];
  if (o.title) {
    y += h * 0.05;
    parts.push(
      `<text x="${n(cx)}" y="${n(y)}" text-anchor="middle" font-family="${esc(font)}" font-size="${n(Math.min(w, h) * 0.065)}" fill="${esc(o.text)}">${esc(o.title)}</text>`,
    );
  }
  if (o.subtitle) {
    y += h * 0.04;
    parts.push(
      `<text x="${n(cx)}" y="${n(y)}" text-anchor="middle" font-family="${esc(font)}" font-size="${n(Math.min(w, h) * 0.03)}" fill="${esc(o.text)}" opacity="0.8">${esc(o.subtitle)}</text>`,
    );
  }
  if (o.qr) {
    const size = Math.min(w, h) * 0.14;
    const quiet = 2;
    const cell = size / (o.qr.count + 2 * quiet);
    const x0 = cx - size / 2;
    const y0 = y + Math.min(w, h) * 0.025;
    let d = '';
    for (let qy = 0; qy < o.qr.count; qy++)
      for (let qx = 0; qx < o.qr.count; qx++)
        if (o.qr.dark(qx, qy))
          d += `M${n(x0 + (qx + quiet) * cell)} ${n(y0 + (qy + quiet) * cell)}h${n(cell)}v${n(cell)}h${n(-cell)}z`;
    // A light square behind, so phones read it on any background.
    parts.push(
      `<rect x="${n(x0)}" y="${n(y0)}" width="${n(size)}" height="${n(size)}" fill="#ffffff" rx="${n(cell)}"/>`,
    );
    parts.push(`<path d="${d}" fill="#000000"/>`);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${esc(o.background)}"/>` +
    parts.join('') +
    '</svg>'
  );
}
