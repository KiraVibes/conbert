import { lz77Compress, lz77Decompress } from './lz77';
import { PALETTE_SIZE, buildLookup, buildPalette, quantize, type Palette } from './palette';

/**
 * Conbert GBA video stream ("CGBV"), decoded by the player in gba-player/.
 *
 * Every frame is one record (word-aligned):
 *   u32 size of the record in bytes
 *   u8  type: 1 = keyframe (all pixels), 0 = update (only changed 8×8 blocks)
 *   u8  1 if a palette follows
 *   u16 0
 *   [u16 × 256 palette, BGR555]  – only with keyframes
 *   LZ77 data (GBA BIOS format) of:
 *     keyframe: width × height palette indices
 *     update:   bitmap of changed blocks (1 bit per block, LSB first, padded
 *               to 4 bytes), then 64 indices per changed block (8 rows of 8)
 */

export const FRAME_UPDATE = 0;
export const FRAME_KEY = 1;
const BLOCK = 8;

/** Mean luma difference that counts as a scene cut (new palette + keyframe). */
const SCENE_CUT = 28;

export interface EncoderSettings {
  width: number;
  height: number;
  /** Max mean squared RGB distance per pixel before a block is redrawn. */
  blockThreshold: number;
  /** A new keyframe and palette at the latest after this many frames. */
  maxGroupFrames: number;
}

function lumaDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  let n = 0;
  // Every 7th pixel is plenty to spot a cut.
  for (let i = 0; i < a.length; i += 21) {
    const la = (a[i] ?? 0) * 2 + (a[i + 1] ?? 0) * 5 + (a[i + 2] ?? 0);
    const lb = (b[i] ?? 0) * 2 + (b[i + 1] ?? 0) * 5 + (b[i + 2] ?? 0);
    sum += Math.abs(la - lb);
    n++;
  }
  return n === 0 ? 0 : sum / n / 8;
}

function record(type: number, palette: Palette | null, payload: Uint8Array): Uint8Array {
  const paletteBytes = palette ? PALETTE_SIZE * 2 : 0;
  const size = 8 + paletteBytes + payload.length; // payload is word-aligned already
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, size, true);
  out[4] = type;
  out[5] = palette ? 1 : 0;
  if (palette) {
    for (let k = 0; k < PALETTE_SIZE; k++) view.setUint16(8 + k * 2, palette.colors[k] ?? 0, true);
  }
  out.set(payload, 8 + paletteBytes);
  return out;
}

/**
 * Turns RGB24 frames into CGBV records. Frames are collected per scene, so
 * each scene gets its own palette; within a scene only blocks that visibly
 * changed are stored.
 */
export class GbaVideoEncoder {
  private group: Uint8Array[] = [];
  private reference: Uint8Array | null = null;
  private palette: Palette | null = null;
  private readonly blocksX: number;
  private readonly blocksY: number;
  private readonly bitmapBytes: number;

  constructor(private readonly settings: EncoderSettings) {
    if (settings.width % BLOCK !== 0 || settings.height % BLOCK !== 0) {
      throw new Error('gba: width and height must be multiples of 8');
    }
    this.blocksX = settings.width / BLOCK;
    this.blocksY = settings.height / BLOCK;
    this.bitmapBytes = (Math.ceil((this.blocksX * this.blocksY) / 8) + 3) & ~3;
  }

  /** Adds one RGB24 frame; returns the records that are finished. */
  push(frame: Uint8Array): Uint8Array[] {
    const last = this.group.at(-1);
    const cut = last !== undefined && lumaDiff(last, frame) > SCENE_CUT;
    const full = this.group.length >= this.settings.maxGroupFrames;
    const done = cut || full ? this.flush() : [];
    this.group.push(frame);
    return done;
  }

  /** Encodes what is left. */
  finish(): Uint8Array[] {
    return this.flush();
  }

  private flush(): Uint8Array[] {
    if (this.group.length === 0) return [];
    const { width, height } = this.settings;
    this.palette = buildPalette(this.group);
    const lut = buildLookup(this.palette);
    const records = this.group.map((frame, index) => {
      const indices = quantize(frame, width, height, lut);
      return index === 0 ? this.keyframe(indices) : this.update(indices);
    });
    this.group = [];
    return records;
  }

  private keyframe(indices: Uint8Array): Uint8Array {
    this.reference = indices;
    return record(FRAME_KEY, this.palette, lz77Compress(indices));
  }

  private update(indices: Uint8Array): Uint8Array {
    const ref = this.reference;
    const rgb = this.palette?.rgb;
    if (!ref || !rgb) return this.keyframe(indices);
    const { width, blockThreshold } = this.settings;
    const limit = blockThreshold * BLOCK * BLOCK;
    const bitmap = new Uint8Array(this.bitmapBytes);
    const changed: number[] = [];
    for (let by = 0; by < this.blocksY; by++) {
      for (let bx = 0; bx < this.blocksX; bx++) {
        let error = 0;
        for (let y = 0; y < BLOCK; y++) {
          const row = (by * BLOCK + y) * width + bx * BLOCK;
          for (let x = 0; x < BLOCK; x++) {
            const a = indices[row + x] ?? 0;
            const b = ref[row + x] ?? 0;
            if (a === b) continue;
            const dr = (rgb[a * 3] ?? 0) - (rgb[b * 3] ?? 0);
            const dg = (rgb[a * 3 + 1] ?? 0) - (rgb[b * 3 + 1] ?? 0);
            const db = (rgb[a * 3 + 2] ?? 0) - (rgb[b * 3 + 2] ?? 0);
            error += dr * dr + dg * dg + db * db;
          }
        }
        if (error > limit) {
          const block = by * this.blocksX + bx;
          bitmap[block >> 3] = (bitmap[block >> 3] ?? 0) | (1 << (block & 7));
          changed.push(block);
        }
      }
    }
    const payload = new Uint8Array(this.bitmapBytes + changed.length * BLOCK * BLOCK);
    payload.set(bitmap);
    let o = this.bitmapBytes;
    for (const block of changed) {
      const bx = block % this.blocksX;
      const by = Math.floor(block / this.blocksX);
      for (let y = 0; y < BLOCK; y++) {
        const row = (by * BLOCK + y) * width + bx * BLOCK;
        for (let x = 0; x < BLOCK; x++) {
          const v = indices[row + x] ?? 0;
          payload[o++] = v;
          // What the GBA will show from now on.
          ref[row + x] = v;
        }
      }
    }
    return record(FRAME_UPDATE, null, lz77Compress(payload));
  }
}

export interface DecodedFrame {
  indices: Uint8Array;
  palette: Uint16Array;
}

/** Reference decoder doing exactly what the GBA player does – for tests. */
export function decodeRecords(
  data: Uint8Array,
  frameCount: number,
  width: number,
  height: number,
): DecodedFrame[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const frames: DecodedFrame[] = [];
  const screen = new Uint8Array(width * height);
  let palette = new Uint16Array(PALETTE_SIZE);
  const blocksX = width / BLOCK;
  const blocks = blocksX * (height / BLOCK);
  const bitmapBytes = (Math.ceil(blocks / 8) + 3) & ~3;
  let p = 0;
  for (let f = 0; f < frameCount; f++) {
    const size = view.getUint32(p, true);
    const type = data[p + 4];
    let q = p + 8;
    if (data[p + 5]) {
      palette = new Uint16Array(PALETTE_SIZE);
      for (let k = 0; k < PALETTE_SIZE; k++) palette[k] = view.getUint16(q + k * 2, true);
      q += PALETTE_SIZE * 2;
    }
    const payload = lz77Decompress(data.subarray(q, p + size));
    if (type === FRAME_KEY) {
      screen.set(payload.subarray(0, width * height));
    } else {
      let o = bitmapBytes;
      for (let block = 0; block < blocks; block++) {
        if (!((payload[block >> 3] ?? 0) & (1 << (block & 7)))) continue;
        const bx = block % blocksX;
        const by = Math.floor(block / blocksX);
        for (let y = 0; y < BLOCK; y++) {
          screen.set(payload.subarray(o, o + BLOCK), (by * BLOCK + y) * width + bx * BLOCK);
          o += BLOCK;
        }
      }
    }
    frames.push({ indices: screen.slice(), palette });
    p += size;
  }
  return frames;
}
