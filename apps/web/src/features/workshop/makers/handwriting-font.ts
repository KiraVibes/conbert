import {
  cellBox,
  cellWritingArea,
  cleanFontName,
  HANDWRITING_CHARS,
  SHEET,
  unitsPerMm,
  UNITS_PER_EM,
  type Glyph,
} from '@conbert/core';

const PT = 72 / 25.4;

export interface SheetTexts {
  title: string;
  instructions: string;
  footer: string;
}

/** The printable sheet: corner squares, one box per character with guide lines. */
export async function makeHandwritingSheet(texts: SheetTexts): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([SHEET.width * PT, SHEET.height * PT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // pdf-lib counts from the bottom; the sheet layout from the top.
  const X = (mm: number) => mm * PT;
  const Y = (mm: number) => (SHEET.height - mm) * PT;
  // Standard fonts know Latin-1 (+ €) only.
  const safe = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff€]/g, '?');
  for (const [x, y] of SHEET.markers)
    page.drawRectangle({
      x: X(x),
      y: Y(y + SHEET.marker),
      width: SHEET.marker * PT,
      height: SHEET.marker * PT,
      color: rgb(0, 0, 0),
    });
  page.drawText(safe(texts.title), { x: X(24), y: Y(16), size: 13, font: bold });
  page.drawText(safe(texts.instructions), {
    x: X(24),
    y: Y(22),
    size: 7.5,
    font,
    color: rgb(0.3, 0.3, 0.3),
    maxWidth: X(160),
    lineHeight: 9,
  });
  const grey = rgb(0.78, 0.78, 0.78);
  const blue = rgb(0.62, 0.77, 1);
  HANDWRITING_CHARS.forEach((ch, i) => {
    const b = cellBox(i);
    const a = cellWritingArea(i);
    page.drawRectangle({
      x: X(b.x),
      y: Y(b.y + b.h),
      width: b.w * PT,
      height: b.h * PT,
      borderColor: grey,
      borderWidth: 0.6,
    });
    page.drawText(safe(ch), {
      x: X(b.x + 1.2),
      y: Y(b.y + 3.1),
      size: 8,
      font,
      color: rgb(0.55, 0.55, 0.55),
    });
    const base = a.y + a.h * SHEET.baseline;
    const xh = a.y + a.h * SHEET.xHeight;
    page.drawLine({
      start: { x: X(a.x), y: Y(base) },
      end: { x: X(a.x + a.w), y: Y(base) },
      thickness: 0.6,
      color: blue,
    });
    page.drawLine({
      start: { x: X(a.x), y: Y(xh) },
      end: { x: X(a.x + a.w), y: Y(xh) },
      thickness: 0.4,
      color: blue,
      dashArray: [2, 2],
    });
  });
  page.drawText(safe(texts.footer), {
    x: X(24),
    y: Y(284),
    size: 7,
    font,
    color: rgb(0.45, 0.45, 0.45),
  });
  return doc.save();
}

/** Upper and lower case stand in for each other when one of them is missing. */
function partner(ch: string): string | null {
  const up = ch.toUpperCase();
  const low = ch.toLowerCase();
  if (up !== ch && up.length === 1) return up;
  if (low !== ch && low.length === 1) return low;
  return null;
}

export interface BuiltFont {
  otf: ArrayBuffer;
  /** Characters with no box filled in (and no stand-in). */
  missing: string[];
  /** Characters that borrowed the other case. */
  borrowed: string[];
}

/** The glyphs (in sheet order) as an OpenType font. */
export async function buildFont(
  glyphs: readonly (Glyph | null)[],
  name: string,
): Promise<BuiltFont> {
  const opentype = await import('opentype.js');
  const byChar = new Map<string, Glyph>();
  HANDWRITING_CHARS.forEach((ch, i) => {
    const g = glyphs[i];
    if (g) byChar.set(ch, g);
  });
  const missing: string[] = [];
  const borrowed: string[] = [];
  const toPath = (g: Glyph) => {
    const path = new opentype.Path();
    for (const c of g.commands) {
      if (c.type === 'M') path.moveTo(c.x, c.y);
      else if (c.type === 'Q') path.quadraticCurveTo(c.x1, c.y1, c.x, c.y);
      else path.close();
    }
    return path;
  };
  const lower = [...'aeinorsu'].map((c) => byChar.get(c)?.advance).filter((a): a is number => !!a);
  const space = lower.length
    ? Math.round((lower.reduce((s, a) => s + a, 0) / lower.length) * 0.6)
    : 300;
  const list = [
    new opentype.Glyph({ name: '.notdef', advanceWidth: 500, path: new opentype.Path() }),
    new opentype.Glyph({
      name: 'space',
      unicode: 32,
      advanceWidth: space,
      path: new opentype.Path(),
    }),
  ];
  for (const ch of HANDWRITING_CHARS) {
    let g = byChar.get(ch);
    if (!g) {
      const p = partner(ch);
      const other = p ? byChar.get(p) : undefined;
      if (other) {
        g = other;
        borrowed.push(ch);
      } else {
        missing.push(ch);
        continue;
      }
    }
    const code = ch.codePointAt(0) ?? 0;
    list.push(
      new opentype.Glyph({
        name: `uni${code.toString(16).toUpperCase().padStart(4, '0')}`,
        unicode: code,
        advanceWidth: g.advance,
        path: toPath(g),
      }),
    );
  }
  const area = cellWritingArea(0);
  const descender = -Math.round(area.h * (1 - SHEET.baseline) * unitsPerMm());
  const font = new opentype.Font({
    familyName: cleanFontName(name),
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: 800,
    descender,
    glyphs: list,
  });
  return { otf: font.toArrayBuffer(), missing, borrowed };
}
