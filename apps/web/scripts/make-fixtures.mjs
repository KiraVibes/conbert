// Generates the tiny test images in src/engines/__fixtures__ with wasm-vips.
// Run with `pnpm --filter @conbert/web fixtures`. Output is committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Vips from 'wasm-vips';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../src/engines/__fixtures__');
mkdirSync(out, { recursive: true });

const vips = await Vips({ dynamicLibraries: ['vips-jxl.wasm', 'vips-heif.wasm'] });

// 8×8 pixels: left half red, right half blue, with a half-transparent column.
const red = vips.Image.black(4, 8, { bands: 3 }).add([220, 40, 40]).cast('uchar');
const blue = vips.Image.black(4, 8, { bands: 3 }).add([40, 60, 220]).cast('uchar');
const rgb = red.join(blue, 'horizontal').copy({ interpretation: 'srgb' });
// Draw operations modify the image in place, so draw on a private copy.
const alpha = vips.Image.black(8, 8).add(255).cast('uchar').copy();
alpha.drawRect([128], 6, 0, 2, 8);
const rgba = rgb.bandjoin(alpha).copy({ interpretation: 'srgb' });

const write = (name, buffer) => {
  writeFileSync(path.join(out, name), buffer);
  console.warn(`${name}: ${buffer.length} bytes`);
};

write('sample.png', rgba.writeToBuffer('.png'));
write('sample.jpg', rgb.writeToBuffer('.jpg', { Q: 90 }));
write('sample.webp', rgba.writeToBuffer('.webp', { Q: 90 }));
write('sample.tiff', rgba.writeToBuffer('.tif'));
write('sample.avif', rgba.writeToBuffer('.avif', { Q: 60, effort: 0 }));
write('sample.jxl', rgba.writeToBuffer('.jxl', { Q: 90, effort: 1 }));

// Animated GIF with two frames (frames stacked vertically + page-height).
const frames = vips.Image.arrayjoin([rgb, rgb.invert()], { across: 1 }).copy();
frames.setInt('page-height', 8);
frames.setArrayInt('delay', [200, 200]);
write('sample-animated.gif', frames.writeToBuffer('.gif'));

write(
  'sample.svg',
  new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">' +
      '<rect width="4" height="8" fill="#dc2828"/><rect x="4" width="4" height="8" fill="#283cdc"/>' +
      '</svg>\n',
  ),
);

process.exit(0);
