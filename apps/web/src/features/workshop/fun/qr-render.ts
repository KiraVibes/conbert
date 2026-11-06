/**
 * Draws QR codes ourselves (PNG and SVG) from the module grid that the
 * `qrcode` library computes – so colours and a logo in the middle are
 * possible. The library is loaded only when this trick is opened.
 */

export interface QrStyle {
  foreground: string;
  background: string;
  /** Edge length of the whole picture in pixels. */
  size: number;
  /** A picture for the middle (data URL), or null. */
  logo: string | null;
}

export interface QrMatrix {
  /** Modules per side. */
  count: number;
  dark: (x: number, y: number) => boolean;
}

/** Free border around the code (the standard asks for 4 modules). */
const QUIET = 4;
/** The logo covers at most this share of the width – level H repairs up to 30 %. */
const LOGO_SHARE = 0.22;

export class QrTooLongError extends Error {}

export async function qrMatrix(text: string, withLogo: boolean): Promise<QrMatrix> {
  const QRCode = (await import('qrcode')).default;
  try {
    // With a logo, the strongest error correction (H) makes up for the hidden part.
    const qr = QRCode.create(text, { errorCorrectionLevel: withLogo ? 'H' : 'M' });
    const { size, data } = qr.modules;
    return { count: size, dark: (x, y) => data[y * size + x] === 1 };
  } catch {
    throw new QrTooLongError();
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function logoBox(total: number) {
  const side = Math.round(total * LOGO_SHARE);
  const pad = Math.round(side * 0.12);
  return { side, pad, at: Math.round((total - side) / 2) };
}

export async function qrPng(m: QrMatrix, style: QrStyle): Promise<Blob> {
  const cells = m.count + 2 * QUIET;
  const scale = Math.max(1, Math.floor(style.size / cells));
  const total = cells * scale;
  const canvas = document.createElement('canvas');
  canvas.width = total;
  canvas.height = total;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, total, total);
  ctx.fillStyle = style.foreground;
  for (let y = 0; y < m.count; y++) {
    for (let x = 0; x < m.count; x++) {
      if (m.dark(x, y)) ctx.fillRect((x + QUIET) * scale, (y + QUIET) * scale, scale, scale);
    }
  }
  if (style.logo) {
    const img = await loadImage(style.logo);
    const { side, pad, at } = logoBox(total);
    ctx.fillStyle = style.background;
    ctx.beginPath();
    ctx.roundRect(at - pad, at - pad, side + 2 * pad, side + 2 * pad, pad);
    ctx.fill();
    // Keep the logo's proportions inside the square.
    const ratio = img.width / img.height;
    const w = ratio >= 1 ? side : side * ratio;
    const h = ratio >= 1 ? side / ratio : side;
    ctx.drawImage(img, at + (side - w) / 2, at + (side - h) / 2, w, h);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Vector version: sharp at any size (print, posters). Rows are merged into runs. */
export async function qrSvg(m: QrMatrix, style: QrStyle): Promise<string> {
  const cells = m.count + 2 * QUIET;
  let path = '';
  for (let y = 0; y < m.count; y++) {
    let x = 0;
    while (x < m.count) {
      if (!m.dark(x, y)) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < m.count && m.dark(x + run, y)) run++;
      path += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`;
      x += run;
    }
  }
  let logo = '';
  if (style.logo) {
    const img = await loadImage(style.logo);
    const { side, pad, at } = logoBox(cells);
    const ratio = img.width / img.height;
    const w = ratio >= 1 ? side : side * ratio;
    const h = ratio >= 1 ? side / ratio : side;
    logo =
      `<rect x="${at - pad}" y="${at - pad}" width="${side + 2 * pad}" height="${side + 2 * pad}" rx="${pad}" fill="${attr(style.background)}"/>` +
      `<image x="${at + (side - w) / 2}" y="${at + (side - h) / 2}" width="${w}" height="${h}" href="${attr(style.logo)}"/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cells} ${cells}" width="${style.size}" height="${style.size}" shape-rendering="crispEdges"><rect width="${cells}" height="${cells}" fill="${attr(style.background)}"/><path d="${path}" fill="${attr(style.foreground)}"/>${logo}</svg>
`;
}

/** Relative brightness of "#rrggbb" (0 = black, 1 = white). */
export function brightness(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
