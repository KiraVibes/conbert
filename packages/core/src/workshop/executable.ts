import { extFromName } from './identify';
import { u16le, u32le } from './reader';

/**
 * The workshop never hides programs or scripts (see the spec's limits):
 * hiding tricks reject them by name and by content.
 */

const EXTENSIONS = new Set([
  // Windows programs and installers
  'exe', 'com', 'scr', 'pif', 'dll', 'sys', 'cpl', 'msi', 'msp', 'msc', 'appx', 'msix',
  // Scripts
  'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'wsf', 'wsh', 'hta',
  'sh', 'bash', 'zsh', 'py', 'pyw', 'pl', 'rb', 'php', 'lua', 'applescript', 'scpt',
  // Other systems and runtimes
  'app', 'elf', 'run', 'so', 'dylib', 'apk', 'xapk', 'ipa', 'deb', 'rpm',
  'jar', 'class', 'dex', 'appimage', 'command', 'pkg', 'dmg',
  // Shortcuts and things that run code when opened
  'lnk', 'url', 'reg', 'inf', 'scf', 'chm',
  // Office files with macros
  'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm', 'xlam', 'ppam',
]); // prettier-ignore

/** What the start of a file says: a program or a script? */
function executableContent(head: Uint8Array): boolean {
  const b0 = head[0] ?? -1;
  const b1 = head[1] ?? -1;
  if (b0 === 0x4d && b1 === 0x5a) return true; // MZ: Windows program
  if (b0 === 0x23 && b1 === 0x21) return true; // #!: script
  if (head.length >= 4) {
    const le = u32le(head, 0);
    // ELF, Mach-O (32/64 bit, both byte orders), fat binaries / Java classes, Dalvik.
    if (le === 0x464c457f) return true;
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xbebafeca].includes(le)) return true;
    if (le === 0x0a786564) return true;
    // Windows shortcut (.lnk): header size 0x4C.
    if (le === 0x0000004c && u16le(head, 4) === 0x0201) return true;
  }
  // HTML or SVG with script in it.
  const text = new TextDecoder('latin1').decode(head.subarray(0, 4096)).toLowerCase();
  if (/<script|javascript:|\son[a-z]+\s*=/.test(text) && /<(html|svg|body|!doctype)/.test(text)) {
    return true;
  }
  return false;
}

/** True when a file looks like a program, a script or a file that runs code. */
export function looksExecutable(name: string, head: Uint8Array): boolean {
  const ext = extFromName(name);
  if (ext && EXTENSIONS.has(ext)) return true;
  // Double extensions like "bild.jpg.exe" are caught above; a name ending in
  // spaces or dots hides the real one on Windows.
  if (/[\s.]+$/.test(name) && name.trim().length > 0) {
    const trimmed = name.replace(/[\s.]+$/, '');
    const inner = extFromName(trimmed);
    if (inner && EXTENSIONS.has(inner)) return true;
  }
  return executableContent(head);
}

/**
 * The same check for everything inside a ZIP (names from the central
 * directory, which is enough to see a program in an archive).
 */
export function zipHasExecutable(names: readonly string[]): string | null {
  for (const name of names) {
    const base = name.split('/').pop() ?? name;
    if (base && looksExecutable(base, new Uint8Array())) return name;
  }
  return null;
}
