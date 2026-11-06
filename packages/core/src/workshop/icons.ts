/**
 * Icon files from PNG pictures: Windows ICO, macOS ICNS and the web app
 * manifest. Both icon formats may simply contain PNG data, so no own
 * bitmap encoder is needed.
 */

/** favicon.ico: the sizes browsers and Windows ask for. */
export const ICO_SIZES = [16, 32, 48] as const;

/** ICNS entry types holding PNG data, with their pixel size. */
export const ICNS_TYPES: readonly { type: string; size: number }[] = [
  { type: 'icp4', size: 16 },
  { type: 'icp5', size: 32 },
  { type: 'ic11', size: 32 }, // 16@2x
  { type: 'icp6', size: 64 },
  { type: 'ic12', size: 64 }, // 32@2x
  { type: 'ic07', size: 128 },
  { type: 'ic08', size: 256 },
  { type: 'ic13', size: 256 }, // 128@2x
  { type: 'ic09', size: 512 },
  { type: 'ic14', size: 512 }, // 256@2x
  { type: 'ic10', size: 1024 }, // 512@2x
];

/** Every size the icon set needs once. */
export const ICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024] as const;

/** ICO: a small directory, then the PNG files one after the other. */
export function buildIco(images: readonly { size: number; png: Uint8Array }[]): Uint8Array {
  const header = 6 + 16 * images.length;
  const total = header + images.reduce((n, i) => n + i.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true); // type 1 = icon
  view.setUint16(4, images.length, true);
  let offset = header;
  images.forEach((img, n) => {
    const e = 6 + 16 * n;
    // 0 stands for 256 (one byte only).
    out[e] = img.size >= 256 ? 0 : img.size;
    out[e + 1] = img.size >= 256 ? 0 : img.size;
    view.setUint16(e + 4, 1, true); // colour planes
    view.setUint16(e + 6, 32, true); // bits per pixel
    view.setUint32(e + 8, img.png.length, true);
    view.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}

/** ICNS: "icns" + length, then entries of type + length + PNG (big-endian). */
export function buildIcns(pngBySize: ReadonlyMap<number, Uint8Array>): Uint8Array {
  const entries = ICNS_TYPES.flatMap(({ type, size }) => {
    const png = pngBySize.get(size);
    return png ? [{ type, png }] : [];
  });
  const total = 8 + entries.reduce((n, e) => n + 8 + e.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const ascii = (s: string, at: number) => {
    for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii('icns', 0);
  view.setUint32(4, total);
  let offset = 8;
  for (const e of entries) {
    ascii(e.type, offset);
    view.setUint32(offset + 4, 8 + e.png.length);
    out.set(e.png, offset + 8);
    offset += 8 + e.png.length;
  }
  return out;
}

export interface ManifestInput {
  name: string;
  shortName: string;
  themeColor: string;
  backgroundColor: string;
}

/** site.webmanifest: lets phones put the site on the home screen with its icon. */
export function webManifest(m: ManifestInput): string {
  return `${JSON.stringify(
    {
      name: m.name,
      short_name: m.shortName || m.name,
      icons: [
        { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
        {
          src: '/maskable-512x512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
      theme_color: m.themeColor,
      background_color: m.backgroundColor,
      display: 'standalone',
    },
    null,
    2,
  )}\n`;
}

/** The lines for the <head> of a web page. */
export function faviconHtml(themeColor: string): string {
  return [
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
    // Only a real colour ends up in the HTML.
    `<meta name="theme-color" content="${/^#[0-9a-f]{3,8}$/i.test(themeColor) ? themeColor : '#ffffff'}">`,
  ].join('\n');
}
