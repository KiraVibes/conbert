import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { dangerCheck } from './danger';
import { abilitiesFor, inspectProgram, libraryKind } from './program';
import { bytesReader } from './reader';
import { classifyString, findStrings } from './strings';

const enc = (s: string) => new TextEncoder().encode(s);

/** A tiny 64-bit Windows console program that imports CreateRemoteThread and is "signed". */
function tinyPe(): Uint8Array {
  const b = new Uint8Array(0x400);
  const v = new DataView(b.buffer);
  b.set([0x4d, 0x5a]);
  v.setUint32(0x3c, 0x40, true);
  v.setUint32(0x40, 0x00004550, true);
  const coff = 0x44;
  v.setUint16(coff, 0x8664, true);
  v.setUint16(coff + 2, 1, true);
  v.setUint32(coff + 4, Date.UTC(2021, 5, 1) / 1000, true);
  v.setUint16(coff + 16, 240, true);
  v.setUint16(coff + 18, 0x22, true);
  const opt = coff + 20;
  v.setUint16(opt, 0x20b, true);
  v.setUint16(opt + 68, 3, true);
  v.setUint32(opt + 108, 16, true);
  const dirs = opt + 112;
  v.setUint32(dirs + 8, 0x1000, true); // import table
  v.setUint32(dirs + 12, 40, true);
  v.setUint32(dirs + 4 * 8 + 4, 128, true); // certificate table size
  const sec = opt + 240;
  b.set(enc('.text'), sec);
  v.setUint32(sec + 8, 0x200, true);
  v.setUint32(sec + 12, 0x1000, true);
  v.setUint32(sec + 16, 0x200, true);
  v.setUint32(sec + 20, 0x200, true);
  const raw = (rva: number) => 0x200 + rva - 0x1000;
  v.setUint32(raw(0x1000), 0x1100, true);
  v.setUint32(raw(0x1000) + 12, 0x1080, true);
  v.setUint32(raw(0x1000) + 16, 0x1100, true);
  b.set(enc('KERNEL32.dll'), raw(0x1080));
  v.setUint32(raw(0x1100), 0x1120, true);
  b.set(enc('CreateRemoteThread'), raw(0x1120) + 2);
  return b;
}

describe('program inspector', () => {
  it('reads a Windows program', () => {
    const info = inspectProgram(tinyPe());
    expect(info).toMatchObject({
      format: 'pe',
      arch: 'x64',
      bits: 64,
      kind: 'program',
      subsystem: 'console',
      signed: true,
      dotnet: false,
    });
    expect(info?.built?.startsWith('2021-06-01')).toBe(true);
    expect(info?.imports).toEqual([{ library: 'KERNEL32.dll', functions: ['CreateRemoteThread'] }]);
    expect(info?.abilities).toEqual([
      { ability: 'inject', level: 'notable', functions: ['CreateRemoteThread (KERNEL32.dll)'] },
    ]);
  });

  it('reads the real program running this test', () => {
    const info = inspectProgram(new Uint8Array(readFileSync(process.execPath)));
    expect(info?.format).toBe(
      process.platform === 'win32' ? 'pe' : process.platform === 'darwin' ? 'macho' : 'elf',
    );
    expect(info?.sections.length).toBeGreaterThan(2);
  });

  it('does not call every window program a screen grabber', () => {
    const imports = (names: string[]) => [{ library: 'USER32.dll', functions: names }];
    // Drawing a window: GetDC + BitBlt – normal.
    expect(
      abilitiesFor(imports(['GetDC', 'BitBlt', 'IsDebuggerPresent', 'GetAsyncKeyState'])),
    ).toEqual([]);
    // Copying the whole screen: the desktop window + BitBlt.
    expect(abilitiesFor(imports(['GetDesktopWindow', 'BitBlt']))).toEqual([
      {
        ability: 'screen',
        level: 'notable',
        functions: ['BitBlt (USER32.dll)', 'GetDesktopWindow (USER32.dll)'],
      },
    ]);
  });

  it('explains well-known libraries', () => {
    expect(libraryKind('KERNEL32.dll')).toBe('kernel');
    expect(libraryKind('api-ms-win-crt-runtime-l1-1-0.dll')).toBe('runtime');
    expect(libraryKind('api-ms-win-core-synch-l1-2-0.dll')).toBe('apiset');
    expect(libraryKind('libc.so.6')).toBe('libc');
    expect(libraryKind('/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit')).toBe(
      'macframework',
    );
    expect(libraryKind('nvcuda.dll')).toBeNull();
  });

  it('says nothing about other files', () => {
    expect(inspectProgram(enc('hello world, not a program'))).toBeNull();
  });
});

describe('strings finder', () => {
  it('finds text in one- and two-byte form and marks what it is', () => {
    const utf16 = [...'C:\\Users\\Max\\geheim.txt'].flatMap((c) => [c.charCodeAt(0), 0]);
    const bytes = new Uint8Array([
      0,
      1,
      ...enc('visit https://example.org/x now'),
      0,
      0,
      0xff,
      ...utf16,
      0,
      0,
    ]);
    const r = findStrings(bytes);
    expect(r.strings.map((s) => s.text)).toEqual([
      'visit https://example.org/x now',
      'C:\\Users\\Max\\geheim.txt',
    ]);
    expect(r.strings[1]?.encoding).toBe('utf16');
    expect(r.counts.url).toBe(1);
    expect(r.counts.path).toBe(1);
  });

  it('classifies addresses', () => {
    expect(classifyString('mail an max@example.com')).toEqual(['email']);
    expect(classifyString('server 192.168.1.20 port')).toEqual(['ip']);
    expect(classifyString('0x52908400098527886E0F7030069857D2E4169EE7')).toEqual(['crypto']);
    expect(classifyString('999.1.1.1 is no address')).toEqual([]);
  });
});

describe('danger check', () => {
  const check = (bytes: Uint8Array, name: string, ext: string | null) =>
    dangerCheck(bytesReader(bytes), name, ext);

  it('sees a program disguised as a document', async () => {
    const r = await check(tinyPe(), 'Rechnung.pdf', 'exe');
    expect(r.level).toBe('danger');
    expect(r.findings.map((f) => f.key)).toEqual(expect.arrayContaining(['program', 'disguised']));
  });

  it('sees double endings and reversed names', async () => {
    expect((await check(tinyPe(), 'foto.jpg.exe', 'exe')).findings.map((f) => f.key)).toContain(
      'doubleExt',
    );
    const rtlo = await check(enc('x'), 'rechnung\u202Efdp.exe', null);
    expect(rtlo.findings.map((f) => f.key)).toContain('reversedName');
  });

  it('sees macros, external templates and archive tricks', async () => {
    const docx = zipSync({
      '[Content_Types].xml': enc('<Types/>'),
      'word/document.xml': enc('<w:document/>'),
      'word/vbaProject.bin': new Uint8Array(10),
      'word/_rels/settings.xml.rels': enc(
        '<Relationships><Relationship Id="r1" Type="http://x/attachedTemplate" Target="http://evil.example/t.dotm" TargetMode="External"/></Relationships>',
      ),
    });
    const keys = (await check(docx, 'brief.docx', 'zip')).findings.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['macros', 'externalTemplate']));

    const zip = zipSync({ '../../evil.txt': enc('x'), 'setup.exe': enc('MZ') });
    const zipKeys = (await check(zip, 'paket.zip', 'zip')).findings.map((f) => f.key);
    expect(zipKeys).toEqual(expect.arrayContaining(['zipTraversal', 'zipProgram']));
  });

  it('sees PDF scripts and phishing pages', async () => {
    const pdf = enc(
      '%PDF-1.7\n1 0 obj<</OpenAction<</S/JavaScript/JS(app.alert(1))>>>>endobj\n%%EOF',
    );
    const keys = (await check(pdf, 'a.pdf', 'pdf')).findings.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['pdfJavascript', 'pdfAutoAction']));
    const html = enc(
      '<!doctype html><form action="https://x.example"><input type="password"></form>',
    );
    expect((await check(html, 'login.html', null)).findings.map((f) => f.key)).toContain(
      'htmlPassword',
    );
  });

  it('finds nothing in a harmless file', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    expect(await check(png, 'bild.png', 'png')).toEqual({ level: 'safe', findings: [] });
  });
});
