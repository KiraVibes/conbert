import { crc32 } from './crc';
import { identifyFile } from './identify';
import { bytesReader, u32be } from './reader';
import { parseStructure } from './structure';

/**
 * Datei-Reparatur: fixes what can be fixed safely – wrong chunk checksums
 * in PNG, a missing end of PNG/JPEG/GIF (cut-off downloads), data hanging
 * behind the end, a wrong file extension – and says what was broken.
 */

export type RepairKind =
  'pngCrc' | 'pngCut' | 'pngShortened' | 'pngEnd' | 'jpgEnd' | 'gifEnd' | 'appended' | 'extension';

export const REPAIR_KINDS: readonly RepairKind[] = [
  'pngCrc',
  'pngCut',
  'pngShortened',
  'pngEnd',
  'jpgEnd',
  'gifEnd',
  'appended',
  'extension',
];

export interface RepairFix {
  kind: RepairKind;
  /** How many places (checksums …) or bytes it concerned. */
  count?: number;
  /** For the extension: the new name. */
  name?: string;
}

export interface RepairResult {
  fixes: RepairFix[];
  /** The repaired file – null when nothing needed fixing. */
  bytes: Uint8Array | null;
  name: string;
}

export interface RepairOptions {
  /** Cut off data behind the end (may be a hidden archive – then you may want to keep it). */
  cutAppended: boolean;
}

/** Files bigger than this are not repaired in memory. */
export const MAX_REPAIR_BYTES = 512 * 1024 * 1024;

const IEND = Uint8Array.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

async function repairPng(bytes: Uint8Array, fixes: RepairFix[]): Promise<Uint8Array> {
  let out: Uint8Array = bytes.slice();
  const s = await parseStructure(bytesReader(out), 'png');
  if (!s) return out;
  // Wrong checksums: recalculated from type and data.
  let fixed = 0;
  for (const r of s.regions) {
    if (r.kind !== 'checksum' || r.key !== 'png.crc') continue;
    const header = s.regions.find(
      (h) =>
        h.kind === 'chunk' &&
        h.end <= r.start &&
        h.label === r.label &&
        h.start + 8 + Number(h.values?.['bytes'] ?? 0) === r.start,
    );
    if (!header || r.end - r.start < 4) continue;
    const stored = u32be(out, r.start);
    const real = crc32(out.subarray(header.start + 4, r.start));
    if (stored !== real) {
      new DataView(out.buffer, out.byteOffset).setUint32(r.start, real);
      fixed++;
    }
  }
  if (fixed > 0) fixes.push({ kind: 'pngCrc', count: fixed });
  // No IEND: walk the chunks; a cut-off last chunk keeps what is there (a
  // shorter length and a new checksum), then the picture gets its end.
  if (!s.regions.some((r) => r.label === 'IEND')) {
    let pos = 8;
    let keep = 8;
    let tail: Uint8Array | null = null;
    while (pos + 8 <= out.length) {
      const length = u32be(out, pos);
      const type = out.subarray(pos + 4, pos + 8);
      if (!/^[A-Za-z]{4}$/.test(String.fromCharCode(...type))) break;
      if (pos + 12 + length <= out.length) {
        pos += 12 + length;
        keep = pos;
        continue;
      }
      // Cut off inside this chunk: everything after its header counts as data.
      const data = out.subarray(pos + 8);
      if (data.length > 0 && String.fromCharCode(...type) === 'IDAT') {
        tail = new Uint8Array(12 + data.length);
        const view = new DataView(tail.buffer);
        view.setUint32(0, data.length);
        tail.set(type, 4);
        tail.set(data, 8);
        view.setUint32(8 + data.length, crc32(tail.subarray(4, 8 + data.length)));
      }
      break;
    }
    const lost = out.length - keep - (tail ? tail.length - 4 : 0);
    if (tail) fixes.push({ kind: 'pngShortened' });
    else if (lost > 0) fixes.push({ kind: 'pngCut', count: lost });
    out = join(join(out.subarray(0, keep), tail ?? new Uint8Array(0)), IEND);
    fixes.push({ kind: 'pngEnd' });
  }
  return out;
}

/** Repairs a file (as bytes). `detectedExt` comes from the magic-bytes detection. */
export async function repairFile(
  input: Uint8Array,
  name: string,
  detectedExt: string | null,
  options: RepairOptions,
): Promise<RepairResult> {
  const fixes: RepairFix[] = [];
  const identity = identifyFile({ name, detectedExt, head: input.subarray(0, 4096) });
  const ext = identity.realExt ?? identity.nameExt ?? '';
  let bytes = input;

  if (ext === 'png') bytes = await repairPng(bytes, fixes);
  if (ext === 'jpg' || ext === 'gif') {
    const s = await parseStructure(bytesReader(bytes), ext);
    const closed = s?.regions.some((r) => r.key === 'jpg.eoi' || r.key === 'gif.trailer');
    if (s && !closed) {
      bytes = join(bytes, ext === 'jpg' ? Uint8Array.from([0xff, 0xd9]) : Uint8Array.of(0x3b));
      fixes.push({ kind: ext === 'jpg' ? 'jpgEnd' : 'gifEnd' });
    }
  }
  if (options.cutAppended) {
    const s = await parseStructure(bytesReader(bytes), ext);
    if (s?.appendedAt != null && s.appendedAt < bytes.length) {
      fixes.push({ kind: 'appended', count: bytes.length - s.appendedAt });
      bytes = bytes.slice(0, s.appendedAt);
    }
  }
  let outName = name;
  if (identity.suggestedName && identity.realExt) {
    outName = identity.suggestedName;
    fixes.push({ kind: 'extension', name: outName });
  }
  const changedBytes = fixes.some((f) => f.kind !== 'extension');
  return { fixes, bytes: fixes.length > 0 ? (changedBytes ? bytes : input) : null, name: outName };
}
