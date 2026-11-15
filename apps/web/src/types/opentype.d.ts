// opentype.js 2.x ships no type definitions; only the parts Conbert uses.
declare module 'opentype.js' {
  export type PathCommand =
    | { type: 'M' | 'L'; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'Z' };
  export class Path {
    commands: PathCommand[];
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    quadraticCurveTo(x1: number, y1: number, x: number, y: number): void;
    close(): void;
  }
  export class Glyph {
    name: string;
    index: number;
    advanceWidth: number;
    constructor(options: {
      name: string;
      unicode?: number;
      unicodes?: number[];
      advanceWidth: number;
      path: Path;
    });
    /** Outline at (x, y) as baseline origin, y pointing down, `fontSize` in output units. */
    getPath(x: number, y: number, fontSize: number): Path;
  }
  export class Font {
    unitsPerEm: number;
    constructor(options: {
      familyName: string;
      styleName: string;
      unitsPerEm: number;
      ascender: number;
      descender: number;
      glyphs: Glyph[];
    });
    toArrayBuffer(): ArrayBuffer;
    charToGlyph(char: string): Glyph;
  }
  export function parse(buffer: ArrayBuffer): Font;
}
