import { shannonEntropy } from './entropy';

/**
 * Program inspector: reads the header of Windows (PE), Linux (ELF) and macOS
 * (Mach-O) programs – what it is, when it was built, whether it is signed or
 * packed, which libraries it uses and what that lets it do. It only reads,
 * nothing is ever run.
 */

export type ProgramFormat = 'pe' | 'elf' | 'macho';
export type ProgramKind = 'program' | 'library' | 'driver' | 'object' | 'core';

export interface ProgramSection {
  name: string;
  size: number;
  entropy: number;
}

export interface ProgramImport {
  library: string;
  functions: string[];
}

/** Abilities read from the functions a program asks the system for. */
export const PROGRAM_ABILITIES = [
  'keyboard',
  'inject',
  'internet',
  'download',
  'registry',
  'screen',
  'crypto',
  'process',
  'services',
  'debugger',
  'clipboard',
  'microphone',
] as const;
export type ProgramAbility = (typeof PROGRAM_ABILITIES)[number];

export interface ProgramInfo {
  format: ProgramFormat;
  /** 'x86', 'x64', 'arm64' … */
  arch: string;
  bits: 32 | 64;
  kind: ProgramKind;
  /** Windows: a window program or a console program. */
  subsystem: 'gui' | 'console' | 'native' | 'other' | null;
  dotnet: boolean;
  /** When it was built (ISO date), if the program says so. */
  built: string | null;
  /** Has a digital signature (not checked whether it is valid). */
  signed: boolean;
  /** Packer that was found (e.g. UPX) – or 'unknown' for a very dense program. */
  packed: string | null;
  sections: ProgramSection[];
  imports: ProgramImport[];
  abilities: ProgramAbility[];
}

const ABILITY_FUNCTIONS: [ProgramAbility, RegExp][] = [
  ['keyboard', /^(SetWindowsHookEx|GetAsyncKeyState|GetKeyboardState|RegisterRawInputDevices)/],
  ['inject', /^(WriteProcessMemory|CreateRemoteThread|VirtualAllocEx|NtMapViewOfSection|QueueUserAPC|SetThreadContext)/],
  ['internet', /^(InternetOpen|WinHttpOpen|HttpSendRequest|WSAStartup|connect$|socket$|getaddrinfo$|curl_easy)/],
  ['download', /^(URLDownloadToFile|InternetReadFile|WinHttpReadData|BITS)/],
  ['registry', /^(RegSetValue|RegCreateKey|RegDeleteKey|RegDeleteValue)/],
  ['screen', /^(BitBlt|GetDC$|GetWindowDC|CGWindowListCreateImage|CGDisplayCreateImage)/],
  ['crypto', /^(CryptEncrypt|CryptDecrypt|BCryptEncrypt|BCryptDecrypt|EVP_Encrypt|CCCrypt)/],
  ['process', /^(CreateProcess|ShellExecute|WinExec|execve$|system$|posix_spawn)/],
  ['services', /^(CreateService|StartService|ChangeServiceConfig)/],
  ['debugger', /^(IsDebuggerPresent|CheckRemoteDebuggerPresent|NtQueryInformationProcess|ptrace$)/],
  ['clipboard', /^(GetClipboardData|SetClipboardData|OpenClipboard)/],
  ['microphone', /^(waveInOpen|mciSendString|AudioQueueNewInput)/],
]; // prettier-ignore

function abilitiesOf(imports: readonly ProgramImport[]): ProgramAbility[] {
  const found = new Set<ProgramAbility>();
  for (const imp of imports)
    for (const fn of imp.functions)
      for (const [ability, re] of ABILITY_FUNCTIONS) if (re.test(fn)) found.add(ability);
  return PROGRAM_ABILITIES.filter((a) => found.has(a));
}

const cstr = (b: Uint8Array, at: number, max = 256): string => {
  let s = '';
  for (let i = at; i < Math.min(b.length, at + max); i++) {
    const c = b[i] ?? 0;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
};

function packerOf(sections: readonly ProgramSection[]): string | null {
  const names = sections.map((s) => s.name.toLowerCase());
  if (names.some((n) => n.startsWith('upx'))) return 'UPX';
  if (names.some((n) => n === '.aspack' || n === '.adata')) return 'ASPack';
  if (names.some((n) => n.startsWith('.themida') || n === '.winlice')) return 'Themida';
  if (names.some((n) => n === '.vmp0' || n === '.vmp1')) return 'VMProtect';
  if (names.some((n) => n === '.mpress1')) return 'MPRESS';
  const code = sections.filter((s) => s.size > 4096);
  // Very dense code sections hold compressed or encrypted code.
  if (code.length > 0 && code.every((s) => s.entropy > 7.2)) return 'unknown';
  return null;
}

// ---------------------------------------------------------------- Windows (PE)

const PE_MACHINES: Record<number, string> = {
  0x14c: 'x86',
  0x8664: 'x64',
  0xaa64: 'arm64',
  0x1c0: 'arm',
  0x1c4: 'arm',
  0x200: 'ia64',
};

function readPe(b: Uint8Array): ProgramInfo | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 64 || b[0] !== 0x4d || b[1] !== 0x5a) return null;
  const pe = v.getUint32(0x3c, true);
  if (pe + 24 > b.length || v.getUint32(pe, true) !== 0x00004550) return null;
  const machine = v.getUint16(pe + 4, true);
  const nSections = v.getUint16(pe + 6, true);
  const stamp = v.getUint32(pe + 8, true);
  const optSize = v.getUint16(pe + 20, true);
  const chars = v.getUint16(pe + 22, true);
  const opt = pe + 24;
  if (opt + optSize > b.length) return null;
  const magic = v.getUint16(opt, true);
  const is64 = magic === 0x20b;
  const subsystemValue = v.getUint16(opt + 68, true);
  const dirs = opt + (is64 ? 112 : 96);
  const dirCount = Math.min(16, v.getUint32(opt + (is64 ? 108 : 92), true));
  const dir = (i: number) =>
    i < dirCount && dirs + i * 8 + 8 <= b.length
      ? { rva: v.getUint32(dirs + i * 8, true), size: v.getUint32(dirs + i * 8 + 4, true) }
      : { rva: 0, size: 0 };

  const secAt = opt + optSize;
  const raw: { name: string; va: number; vsize: number; ptr: number; rsize: number }[] = [];
  for (let i = 0; i < Math.min(nSections, 96); i++) {
    const s = secAt + i * 40;
    if (s + 40 > b.length) break;
    raw.push({
      name: cstr(b, s, 8),
      vsize: v.getUint32(s + 8, true),
      va: v.getUint32(s + 12, true),
      rsize: v.getUint32(s + 16, true),
      ptr: v.getUint32(s + 20, true),
    });
  }
  const sections = raw.map((s) => ({
    name: s.name,
    size: s.rsize,
    entropy: shannonEntropy(b.subarray(s.ptr, Math.min(b.length, s.ptr + s.rsize))),
  }));
  const offsetOf = (rva: number): number | null => {
    for (const s of raw)
      if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rsize)) return s.ptr + (rva - s.va);
    return null;
  };

  const imports: ProgramImport[] = [];
  const imp = offsetOf(dir(1).rva);
  if (imp !== null) {
    for (let d = imp; d + 20 <= b.length && imports.length < 200; d += 20) {
      const lookup = v.getUint32(d, true) || v.getUint32(d + 16, true);
      const nameRva = v.getUint32(d + 12, true);
      if (!lookup && !nameRva) break;
      const nameAt = offsetOf(nameRva);
      const library = nameAt === null ? '?' : cstr(b, nameAt);
      const functions: string[] = [];
      let t = offsetOf(lookup);
      for (let k = 0; t !== null && k < 2000; k++, t += is64 ? 8 : 4) {
        if (t + (is64 ? 8 : 4) > b.length) break;
        const lo = v.getUint32(t, true);
        const hi = is64 ? v.getUint32(t + 4, true) : 0;
        if (!lo && !hi) break;
        const byOrdinal = is64 ? (hi & 0x80000000) !== 0 : (lo & 0x80000000) !== 0;
        if (byOrdinal) {
          functions.push(`#${lo & 0xffff}`);
          continue;
        }
        const hint = offsetOf(lo & 0x7fffffff);
        if (hint !== null) functions.push(cstr(b, hint + 2));
      }
      imports.push({ library, functions });
    }
  }

  const kind: ProgramKind =
    (chars & 0x2000) !== 0 ? 'library' : subsystemValue === 1 ? 'driver' : 'program';
  // Since about 2015 many compilers write a hash instead of a time ("reproducible builds").
  const built =
    stamp > 631152000 && stamp < Date.now() / 1000 + 86400 * 366
      ? new Date(stamp * 1000).toISOString()
      : null;
  return {
    format: 'pe',
    arch: PE_MACHINES[machine] ?? `0x${machine.toString(16)}`,
    bits: is64 ? 64 : 32,
    kind,
    subsystem:
      subsystemValue === 2
        ? 'gui'
        : subsystemValue === 3
          ? 'console'
          : subsystemValue === 1
            ? 'native'
            : 'other',
    dotnet: dir(14).rva !== 0,
    built,
    signed: dir(4).size > 0,
    packed: packerOf(sections),
    sections,
    imports,
    abilities: abilitiesOf(imports),
  };
}

// ---------------------------------------------------------------- Linux (ELF)

const ELF_MACHINES: Record<number, string> = {
  3: 'x86',
  62: 'x64',
  40: 'arm',
  183: 'arm64',
  243: 'riscv',
  8: 'mips',
  20: 'ppc',
  21: 'ppc64',
};

function readElf(b: Uint8Array): ProgramInfo | null {
  if (b.length < 52 || b[0] !== 0x7f || b[1] !== 0x45 || b[2] !== 0x4c || b[3] !== 0x46)
    return null;
  const is64 = b[4] === 2;
  const le = b[5] !== 2;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o: number) => (o + 2 <= b.length ? v.getUint16(o, le) : 0);
  const u32 = (o: number) => (o + 4 <= b.length ? v.getUint32(o, le) : 0);
  const word = (o: number) =>
    is64 ? Number(o + 8 <= b.length ? v.getBigUint64(o, le) : 0n) : u32(o);
  const type = u16(16);
  const machine = u16(18);
  const shoff = word(is64 ? 40 : 32);
  const shentsize = u16(is64 ? 58 : 46);
  const shnum = Math.min(u16(is64 ? 60 : 48), 512);
  const shstrndx = u16(is64 ? 62 : 50);
  const sec = (i: number) => {
    const s = shoff + i * shentsize;
    return {
      name: u32(s),
      type: u32(s + 4),
      offset: word(s + (is64 ? 24 : 16)),
      size: word(s + (is64 ? 32 : 20)),
      link: u32(s + (is64 ? 40 : 24)),
    };
  };
  const headers =
    shoff > 0 && shoff < b.length ? Array.from({ length: shnum }, (_, i) => sec(i)) : [];
  const names = headers[shstrndx];
  const sections = headers.map((s) => ({
    name: names ? cstr(b, names.offset + s.name, 64) : '',
    size: s.size,
    entropy:
      s.type === 8
        ? 0
        : shannonEntropy(b.subarray(s.offset, Math.min(b.length, s.offset + s.size))),
  }));
  // Libraries it needs (DT_NEEDED in .dynamic) and the functions it takes from them.
  const libraries: string[] = [];
  const functions: string[] = [];
  for (const s of headers) {
    if (s.type === 6) {
      const str = headers[s.link];
      const step = is64 ? 16 : 8;
      for (let o = s.offset; o + step <= Math.min(b.length, s.offset + s.size); o += step) {
        const tag = word(o);
        if (tag === 0) break;
        if (tag === 1 && str) libraries.push(cstr(b, str.offset + word(o + step / 2)));
      }
    }
    if (s.type === 11) {
      // Dynamic symbols: undefined ones (section 0) come from the libraries.
      const str = headers[s.link];
      const step = is64 ? 24 : 16;
      for (
        let o = s.offset;
        o + step <= Math.min(b.length, s.offset + s.size) && functions.length < 3000;
        o += step
      ) {
        const shndx = u16(o + (is64 ? 6 : 14));
        const name = str ? cstr(b, str.offset + u32(o)) : '';
        if (name && shndx === 0) functions.push(name);
      }
    }
  }
  const imports =
    libraries.length > 0 || functions.length > 0
      ? [{ library: libraries.join(', ') || '?', functions }]
      : [];
  const kind: ProgramKind =
    type === 3
      ? headers.some((s) => s.type === 6) && sections.some((s) => s.name === '.interp')
        ? 'program'
        : 'library'
      : type === 1
        ? 'object'
        : type === 4
          ? 'core'
          : 'program';
  return {
    format: 'elf',
    arch: ELF_MACHINES[machine] ?? `#${machine}`,
    bits: is64 ? 64 : 32,
    kind,
    subsystem: null,
    dotnet: false,
    built: null,
    signed: sections.some((s) => s.name === '.sig' || s.name === '.signature'),
    packed: packerOf(sections),
    sections,
    imports,
    abilities: abilitiesOf(imports),
  };
}

// ---------------------------------------------------------------- macOS (Mach-O)

const MACHO_CPUS: Record<number, string> = {
  7: 'x86',
  0x01000007: 'x64',
  12: 'arm',
  0x0100000c: 'arm64',
};

function readMacho(b: Uint8Array, at = 0): ProgramInfo | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (at + 32 > b.length) return null;
  const magic = v.getUint32(at, false);
  // Universal binary: read the first architecture inside.
  if (magic === 0xcafebabe && v.getUint32(at + 4, false) < 20) {
    return readMacho(b, v.getUint32(at + 16, false));
  }
  const le = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const be = magic === 0xfeedface || magic === 0xfeedfacf;
  if (!le && !be) return null;
  const is64 = magic === 0xcffaedfe || magic === 0xfeedfacf;
  const u32 = (o: number) => (o + 4 <= b.length ? v.getUint32(o, le) : 0);
  const cpu = u32(at + 4);
  const filetype = u32(at + 12);
  const ncmds = Math.min(u32(at + 16), 1000);
  let o = at + (is64 ? 32 : 28);
  const libraries: string[] = [];
  const sections: ProgramSection[] = [];
  let signed = false;
  for (let i = 0; i < ncmds && o + 8 <= b.length; i++) {
    const cmd = u32(o);
    const size = u32(o + 4);
    if (size < 8) break;
    if (cmd === 0xc || cmd === 0x80000018 || cmd === 0x1f) libraries.push(cstr(b, o + u32(o + 8)));
    if (cmd === 0x1d) signed = true;
    if (cmd === 0x19 || cmd === 0x1) {
      const name = cstr(b, o + 8, 16);
      const fileoff = is64 ? Number(v.getBigUint64(o + 40, le)) : u32(o + 32);
      const filesize = is64 ? Number(v.getBigUint64(o + 48, le)) : u32(o + 36);
      sections.push({
        name,
        size: filesize,
        entropy: shannonEntropy(
          b.subarray(at + fileoff, Math.min(b.length, at + fileoff + filesize)),
        ),
      });
    }
    o += size;
  }
  const imports = libraries.map((library) => ({ library, functions: [] }));
  return {
    format: 'macho',
    arch: MACHO_CPUS[cpu] ?? `#${cpu}`,
    bits: is64 ? 64 : 32,
    kind:
      filetype === 2
        ? 'program'
        : filetype === 6 || filetype === 8
          ? 'library'
          : filetype === 1
            ? 'object'
            : filetype === 4
              ? 'core'
              : 'program',
    subsystem: null,
    dotnet: false,
    built: null,
    signed,
    packed: packerOf(sections.filter((s) => s.name !== '__LINKEDIT' && s.name !== '__PAGEZERO')),
    sections,
    imports,
    abilities: [],
  };
}

/** Reads a program's header; null when the bytes are no known program format. */
export function inspectProgram(bytes: Uint8Array): ProgramInfo | null {
  try {
    return readPe(bytes) ?? readElf(bytes) ?? readMacho(bytes);
  } catch {
    // A broken header – nothing more to say than "not readable".
    return null;
  }
}
