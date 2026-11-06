import { GBA_MAX_ROM_BYTES } from '@conbert/core';

/**
 * A playable .gba file: the player program, then (256-byte aligned) the
 * video header, the frame records, the keyframe index and the sound. The
 * player finds the header behind its own end.
 *
 * Header (64 bytes, little endian):
 *    0 "CGBV"        4 u16 version   6 u16 flags (1 = sound, 2 = loop)
 *    8 u16 width    10 u16 height   12 s16 BG2PA   14 s16 BG2PD (8.8 scale)
 *   16 s32 BG2X     20 s32 BG2Y     (.8 fixed point, centres the picture)
 *   24 u32 fps numerator            28 u32 fps denominator
 *   32 u32 frame count              36 u32 sample rate
 *   40 u32 sound offset             44 u32 sound length (bytes = samples)
 *   48 u32 frames offset            52 u32 timer reload (65536 − steps)
 *   56 u32 index offset             60 u32 index entries
 *
 * Keyframe index (for jumping): entries of u32 frame number + u32 offset of
 * the keyframe record, both relative to the header.
 */

export const FORMAT_VERSION = 2;
const FLAG_SOUND = 1;
const FLAG_LOOP = 2;
const FRAME_KEY = 1;
const INDEX_ENTRY = 8;

export const HEADER_SIZE = 64;
const DATA_ALIGN = 256;
/** Silence after the sound, so the sound DMA never plays the next bytes. */
const SOUND_TAIL = 4096;

export class GbaRomTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`gba: module would be ${bytes} bytes (max ${GBA_MAX_ROM_BYTES})`);
  }
}

export interface RomInput {
  player: Uint8Array;
  width: number;
  height: number;
  fps: number;
  audioRate: number;
  audioTimerSteps: number;
  /** Signed 8-bit mono samples, or null for a silent module. */
  audio: Uint8Array | null;
  records: readonly Uint8Array[];
  /** Shown as the game title (12 ASCII characters). */
  title: string;
  /** Start with endless playback switched on (SELECT toggles it on the GBA). */
  loop?: boolean;
}

const align = (n: number, to: number) => Math.ceil(n / to) * to;

/** Size of the finished module – to stop early when it can't fit. */
export function romSize(
  playerBytes: number,
  recordBytes: number,
  audioBytes: number,
  keyframes = 0,
): number {
  const frames = HEADER_SIZE + recordBytes + keyframes * INDEX_ENTRY;
  const sound = audioBytes > 0 ? align(audioBytes, 16) + SOUND_TAIL : 0;
  return align(playerBytes, DATA_ALIGN) + align(frames, 4) + sound;
}

/** Game title for the cartridge header: A–Z, 0–9 and spaces, max. 12. */
export function headerTitle(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (ascii || 'CONBERT').slice(0, 12);
}

export function buildRom(input: RomInput): Uint8Array {
  const recordBytes = input.records.reduce((s, r) => s + r.length, 0);
  const audioBytes = input.audio?.length ?? 0;
  // Where each keyframe starts – the player jumps there and decodes forward.
  const index: { frame: number; offset: number }[] = [];
  let at = HEADER_SIZE;
  for (const [frame, record] of input.records.entries()) {
    if (record[4] === FRAME_KEY) index.push({ frame, offset: at });
    at += record.length;
  }
  const total = romSize(input.player.length, recordBytes, audioBytes, index.length);
  if (total > GBA_MAX_ROM_BYTES) throw new GbaRomTooLargeError(total);

  const rom = new Uint8Array(total);
  rom.set(input.player);
  const base = align(input.player.length, DATA_ALIGN);
  const view = new DataView(rom.buffer);

  // Picture scaled to the full screen width, centred vertically.
  const scale = Math.round((input.width * 256) / 240);
  const shownHeight = (input.height * 256) / scale;
  const offsetY = Math.max(0, Math.round((160 - shownHeight) / 2));
  const framesOffset = HEADER_SIZE;
  const indexOffset = HEADER_SIZE + recordBytes; // records are word-aligned
  const audioOffset = align(indexOffset + index.length * INDEX_ENTRY, 4);

  rom.set([0x43, 0x47, 0x42, 0x56], base); // "CGBV"
  view.setUint16(base + 4, FORMAT_VERSION, true);
  view.setUint16(base + 6, (input.audio ? FLAG_SOUND : 0) | (input.loop ? FLAG_LOOP : 0), true);
  view.setUint16(base + 8, input.width, true);
  view.setUint16(base + 10, input.height, true);
  view.setInt16(base + 12, scale, true);
  view.setInt16(base + 14, scale, true);
  view.setInt32(base + 16, 0, true);
  view.setInt32(base + 20, -offsetY * scale, true);
  view.setUint32(base + 24, input.fps, true);
  view.setUint32(base + 28, 1, true);
  view.setUint32(base + 32, input.records.length, true);
  view.setUint32(base + 36, input.audioRate, true);
  view.setUint32(base + 40, input.audio ? audioOffset : 0, true);
  view.setUint32(base + 44, audioBytes, true);
  view.setUint32(base + 48, framesOffset, true);
  view.setUint32(base + 52, 65536 - input.audioTimerSteps, true);
  view.setUint32(base + 56, indexOffset, true);
  view.setUint32(base + 60, index.length, true);

  let o = base + framesOffset;
  for (const r of input.records) {
    rom.set(r, o);
    o += r.length;
  }
  for (const [k, entry] of index.entries()) {
    view.setUint32(base + indexOffset + k * INDEX_ENTRY, entry.frame, true);
    view.setUint32(base + indexOffset + k * INDEX_ENTRY + 4, entry.offset, true);
  }
  if (input.audio) rom.set(input.audio, base + audioOffset);

  // Cartridge title and header checksum (the GBA refuses to boot without it).
  const title = headerTitle(input.title);
  for (let k = 0; k < 12; k++) rom[0xa0 + k] = k < title.length ? title.charCodeAt(k) : 0;
  let check = 0;
  for (let k = 0xa0; k <= 0xbc; k++) check = (check - (rom[k] ?? 0)) & 0xff;
  rom[0xbd] = (check - 0x19) & 0xff;
  return rom;
}
